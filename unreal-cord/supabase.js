import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://euyhoyrmkgvawhdagxhl.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_SlspOmr1Y9J9wvxtZqzBfg_7r0m4oKR'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
