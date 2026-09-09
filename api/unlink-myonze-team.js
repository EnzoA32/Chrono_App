// /api/unlink-myonze-team.js
const { createClient } = require('@supabase/supabase-js');

const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if(req.method !== 'POST'){
    res.status(405).json({error:'Method not allowed'});
    return;
  }
  try{
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if(!token){ res.status(401).json({error:'Token manquant.'}); return; }

    const {data:{user}, error: userError} = await supabaseAnon.auth.getUser(token);
    if(userError || !user){ res.status(401).json({error:'Utilisateur non authentifié.'}); return; }

    const {error} = await supabaseAdmin
      .from('profiles')
      .update({ myonze_team_id: null, myonze_team_name: null })
      .eq('id', user.id);

    if(error){ console.error(error); res.status(500).json({error:'Erreur lors de la suppression du lien.'}); return; }

    res.status(200).json({ linked: false });
  } catch(err){
    console.error('unlink-myonze-team error:', err);
    res.status(500).json({error: err.message || 'Erreur serveur.'});
  }
};
