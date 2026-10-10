// Cloudflare Worker: transparent proxy to Supabase so browsers never resolve
// *.supabase.co (blocked/hijacked by some Wi-Fi DNS). Free plan is enough.
const SUPABASE_HOST = 'boghqathvnkygdzxnzkh.supabase.co';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = SUPABASE_HOST;
    url.protocol = 'https:';
    url.port = '';
    // Pass method, headers, body (and websocket upgrades) straight through.
    return fetch(new Request(url.toString(), request));
  },
};
