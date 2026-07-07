// /api/stripe-webhook.js
// Reçoit les événements Stripe (notamment "checkout.session.completed"),
// vérifie leur authenticité via la signature, puis active le compte
// correspondant dans Supabase (is_paid = true). Utilise la clé service_role
// de Supabase, qui contourne les RLS -- cette clé ne doit JAMAIS être
// exposée côté client, elle vit uniquement en variable d'environnement Vercel.

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Nécessaire pour la vérification de signature Stripe : on doit lire le
// corps brut de la requête, sans qu'aucune couche ne l'ait déjà parsé.
function buffer(readable){
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

module.exports.config = { api: { bodyParser: false } };

module.exports = async (req, res) => {
  if(req.method !== 'POST'){
    res.status(405).send('Method not allowed');
    return;
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try{
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch(err){
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try{
    if(event.type === 'checkout.session.completed'){
      const session = event.data.object;
      const userId = session.client_reference_id || (session.metadata && session.metadata.supabase_user_id);

      if(userId){
        const {error} = await supabaseAdmin
          .from('profiles')
          .update({
            is_paid: true,
            stripe_customer_id: session.customer || null,
            stripe_subscription_id: session.subscription || null,
            stripe_session_id: session.id
          })
          .eq('id', userId);

        if(error) console.error('Failed to activate profile:', error);
      } else {
        console.error('No client_reference_id on checkout session', session.id);
      }
    }

    // Abonnement mis à jour (renouvellement, passage en impayé, etc.)
    if(event.type === 'customer.subscription.updated'){
      const subscription = event.data.object;
      const activeStatuses = ['active', 'trialing'];
      const isActive = activeStatuses.includes(subscription.status);

      const {error} = await supabaseAdmin
        .from('profiles')
        .update({ is_paid: isActive, stripe_subscription_id: subscription.id })
        .eq('stripe_customer_id', subscription.customer);

      if(error) console.error('Failed to update profile on subscription update:', error);
    }

    // Abonnement résilié / supprimé définitivement
    if(event.type === 'customer.subscription.deleted'){
      const subscription = event.data.object;

      const {error} = await supabaseAdmin
        .from('profiles')
        .update({ is_paid: false })
        .eq('stripe_customer_id', subscription.customer);

      if(error) console.error('Failed to deactivate profile on subscription deletion:', error);
    }

    res.status(200).json({received: true});
  } catch(err){
    console.error('Webhook handling error:', err);
    res.status(500).json({error: 'Erreur lors du traitement du webhook.'});
  }
};
