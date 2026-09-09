// /api/myonze-roster.js
// Renvoie l'effectif (joueurs) de l'équipe My Onze liée au compte
// Onze MyLive authentifié qui fait la requête. Lecture seule.

const { createClient } = require('@supabase/supabase-js');

const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const myOnzeAdmin = createClient(process.env.MYONZE_SUPABASE_URL, process.env.MYONZE_SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if(req.method !== 'GET'){
    res.status(405).json({error:'Method not allowed'});
    return;
  }
  try{
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if(!token){ res.status(401).json({error:'Token manquant.'}); return; }

    const {data:{user}, error: userError} = await supabaseAnon.auth.getUser(token);
    if(userError || !user){ res.status(401).json({error:'Utilisateur non authentifié.'}); return; }

    const {data: profile, error: profileError} = await supabaseAdmin
      .from('profiles')
      .select('myonze_team_id, myonze_team_name')
      .eq('id', user.id)
      .single();

    if(profileError){ console.error(profileError); res.status(500).json({error:'Erreur de lecture du profil.'}); return; }
    if(!profile || !profile.myonze_team_id){
      res.status(200).json({ linked: false, players: [] });
      return;
    }

    const {data: players, error: playersError} = await myOnzeAdmin
      .from('players')
      .select('id, name, first_name, last_name, number')
      .eq('team_id', profile.myonze_team_id)
      .order('number', {ascending: true, nullsFirst: false});

    if(playersError){ console.error(playersError); res.status(500).json({error:'Erreur de lecture de l\'effectif My Onze.'}); return; }

    const normalized = (players || []).map(p => ({
      id: p.id,
      number: p.number,
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Joueur'
    }));

    res.status(200).json({ linked: true, teamName: profile.myonze_team_name, players: normalized });
  } catch(err){
    console.error('myonze-roster error:', err);
    res.status(500).json({error: err.message || 'Erreur serveur.'});
  }
};
