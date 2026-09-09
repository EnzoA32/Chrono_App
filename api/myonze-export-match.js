// /api/myonze-export-match.js
// Exporte un match terminé vers My Onze : cherche un match programmé
// correspondant (même équipe, même adversaire, pas encore joué) pour le
// compléter au lieu de créer un doublon ; sinon crée un nouveau match.
// Pousse aussi les buts (uniquement pour notre équipe, seuls ceux avec un
// joueur identifié dans l'effectif My Onze peuvent être exportés).

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

function genId(prefix){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
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
    const { opponent, scoreUs, scoreThem, goals } = body;
    // goals: [{ playerId: string|null, assistPlayerId: string|null, minute: number }]

    const {data: profile, error: profileError} = await supabaseAdmin
      .from('profiles')
      .select('myonze_team_id')
      .eq('id', user.id)
      .single();

    if(profileError){ console.error(profileError); res.status(500).json({error:'Erreur de lecture du profil.'}); return; }
    if(!profile || !profile.myonze_team_id){
      res.status(200).json({ exported: false, reason: 'not_linked' });
      return;
    }

    const teamId = profile.myonze_team_id;
    const opponentName = (opponent || '').trim();

    // Cherche un match programmé (pas encore joué) contre ce même adversaire
    const {data: candidates, error: findError} = await myOnzeAdmin
      .from('matches')
      .select('id, date, opponent, score_us, score_them')
      .eq('team_id', teamId)
      .is('score_us', null)
      .is('score_them', null)
      .ilike('opponent', opponentName)
      .order('date', {ascending: true})
      .limit(1);

    if(findError){ console.error(findError); res.status(500).json({error:'Erreur lors de la recherche du match.'}); return; }

    let matchId;
    let linkedExisting = false;

    if(candidates && candidates.length > 0){
      matchId = candidates[0].id;
      linkedExisting = true;
      const {error: updateError} = await myOnzeAdmin
        .from('matches')
        .update({ score_us: scoreUs, score_them: scoreThem })
        .eq('id', matchId);
      if(updateError){ console.error(updateError); res.status(500).json({error:'Erreur lors de la mise à jour du match.'}); return; }
    } else {
      matchId = genId('m');
      const today = new Date().toISOString().slice(0,10);
      const {error: insertError} = await myOnzeAdmin
        .from('matches')
        .insert({
          id: matchId,
          date: today,
          opponent: opponentName,
          score_us: scoreUs,
          score_them: scoreThem,
          team_id: teamId
        });
      if(insertError){ console.error(insertError); res.status(500).json({error:'Erreur lors de la création du match.'}); return; }
    }

    // Pousse les buts identifiés (seuls ceux avec un playerId connu de My Onze)
    let exportedGoals = 0;
    let skippedGoals = 0;
    if(Array.isArray(goals)){
      for(const g of goals){
        if(!g.playerId){ skippedGoals++; continue; }
        const {error: evError} = await myOnzeAdmin
          .from('match_events')
          .insert({
            id: genId('ev'),
            match_id: matchId,
            player_id: g.playerId,
            type: 'goal',
            minute: typeof g.minute === 'number' ? g.minute : null,
            assist_player_id: g.assistPlayerId || null
          });
        if(evError){ console.error('match_events insert error:', evError); skippedGoals++; }
        else exportedGoals++;
      }
    }

    res.status(200).json({
      exported: true,
      linkedExisting,
      matchId,
      exportedGoals,
      skippedGoals
    });
  } catch(err){
    console.error('myonze-export-match error:', err);
    res.status(500).json({error: err.message || 'Erreur serveur.'});
  }
};
