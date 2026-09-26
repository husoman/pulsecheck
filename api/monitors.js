// api/monitors.js
// Handles listing, creating, and deleting a user's monitors.
// Auth works by taking the Supabase access token the frontend sends,
// and passing it through to Supabase so Row Level Security enforces
// "you can only touch your own rows" automatically — no manual checks needed.

import { createClient } from '@supabase/supabase-js';

const FREE_PLAN_MONITOR_LIMIT = 3;

function getClientForRequest(req) {
  const authHeader = req.headers.authorization || '';
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } }
  );
}

export default async function handler(req, res) {
  const supabase = getClientForRequest(req);

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('monitors')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ monitors: data });
  }

  if (req.method === 'POST') {
    const { name, url } = req.body || {};
    if (!name || !url) {
      return res.status(400).json({ error: 'Both name and url are required.' });
    }
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'That URL does not look valid.' });
    }

    // Enforce the free-tier monitor limit.
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single();

    if ((profile?.plan || 'free') === 'free') {
      const { count } = await supabase
        .from('monitors')
        .select('id', { count: 'exact', head: true });
      if ((count || 0) >= FREE_PLAN_MONITOR_LIMIT) {
        return res.status(403).json({
          error: `Free plan is limited to ${FREE_PLAN_MONITOR_LIMIT} monitors. Upgrade to add more.`
        });
      }
    }

    const { data, error } = await supabase
      .from('monitors')
      .insert({ user_id: user.id, name, url })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ monitor: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing monitor id.' });

    const { error } = await supabase.from('monitors').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  return res.status(405).json({ error: `Method ${req.method} not allowed.` });
}
