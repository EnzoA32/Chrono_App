// /api/create-checkout-session.js
// Crée une session de paiement Stripe pour l'utilisateur Supabase authentifié
// qui vient de faire la requête (vérifié via son token, jamais fait confiance
// à un identifiant envoyé librement par le navigateur).

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function readBody(req){
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if(req.method !== 'POST'){
    res.status(405).json({error:'Method not allowed'});
    return;
  }

  try{
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if(!token){
      res.status(401).json({error:'Token manquant.'});
      return;
    }

    // Vérifie le token Supabase et récupère le vrai utilisateur côté serveur
    const {data:{user}, error: userError} = await supabaseAnon.auth.getUser(token);
    if(userError || !user){
      res.status(401).json({error:'Utilisateur non authentifié.'});
      return;
    }

    // Lit le corps de la requête (souvent vide, on n'a besoin que du token)
    await readBody(req);

    const appUrl = process.env.APP_URL || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: user.email,
      client_reference_id: user.id,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      success_url: `${appUrl}/?paid=success`,
      cancel_url: `${appUrl}/?paid=cancelled`,
      metadata: { supabase_user_id: user.id }
    });

    res.status(200).json({url: session.url});
  } catch(err){
    console.error('create-checkout-session error:', err);
    res.status(500).json({error: err.message || 'Erreur serveur.'});
  }
};
