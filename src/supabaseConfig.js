import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://finance-tracker.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_wBxny-c-7GFsoIjS9Xaasw_IguFmgWC'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
