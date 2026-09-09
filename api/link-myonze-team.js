// /api/link-myonze-team.js
// Vérifie un code d'accès (player_access_code) contre le projet Supabase
// de My Onze, et enregistre l'équipe correspondante sur le profil
// Onze MyLive de l'utilisateur authentifié.

const { createClient } = require('@supabase/supabase-js');

const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const myOnzeAdmin = createClient(process.env.MYONZE_SUPABASE_URL, process.env.MYONZE_SUPABASE_SERVICE_ROLE_KEY);

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
    if(!token){ res.status(401).json({error:'Token manquant.'}); return; }

    const {data:{user}, error: userError} = await supabaseAnon.auth.getUser(token);
    if(userError || !user){ res.status(401).json({error:'Utilisateur non authentifié.'}); return; }

    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const code = (body.code || '').trim();

    if(!code){
      res.status(400).json({error:'Merci de renseigner un code.'});
      return;
    }

    // Retire le lien existant si l'utilisateur envoie un code vide géré côté frontend séparément.
    const {data: team, error: teamError} = await myOnzeAdmin
      .from('teams')
      .select('id, name')
      .eq('player_access_code', code)
      .maybeSingle();

    if(teamError){ console.error(teamError); res.status(500).json({error:'Erreur lors de la vérification du code.'}); return; }
    if(!team){
      res.status(404).json({error:"Aucune équipe My Onze ne correspond à ce code. Vérifie qu'il est bien copié en entier."});
      return;
    }

    const {error: updateError} = await supabaseAdmin
      .from('profiles')
      .update({ myonze_team_id: team.id, myonze_team_name: team.name })
      .eq('id', user.id);

    if(updateError){ console.error(updateError); res.status(500).json({error:'Erreur lors de la sauvegarde du lien.'}); return; }

    res.status(200).json({ linked: true, teamId: team.id, teamName: team.name });
  } catch(err){
    console.error('link-myonze-team error:', err);
    res.status(500).json({error: err.message || 'Erreur serveur.'});
  }
};
