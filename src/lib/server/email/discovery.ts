import { resolveSrv } from 'node:dns/promises';

export type DiscoveredSettings = {
  host: string;
  port: number;
  username: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
};

export async function discoverAccountSettings(email: string): Promise<DiscoveredSettings | null> {
  const domain = email.split('@')[1];
  if (!domain) return null;

  // 1. Try Mozilla Autoconfig (Thunderbird ISP DB)
  const mozillaSettings = await tryMozillaAutoconfig(domain, email);
  if (mozillaSettings) return mozillaSettings;

  // 2. Try DNS SRV records
  const srvSettings = await tryDnsSrv(domain, email);
  if (srvSettings) return srvSettings;

  // 3. Fallback to common guesses
  return guessSettings(domain, email);
}

async function tryMozillaAutoconfig(domain: string, email: string): Promise<DiscoveredSettings | null> {
  try {
    const url = `https://autoconfig.thunderbird.net/v1.1/${domain}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const xml = await response.text();
    
    // Minimal XML parsing without a heavy library
    const imapHost = xml.match(/<incoming type="imap">[\s\S]*?<hostname>(.*?)<\/hostname>/)?.[1];
    const imapPort = xml.match(/<incoming type="imap">[\s\S]*?<port>(.*?)<\/port>/)?.[1];
    const smtpHost = xml.match(/<outgoing type="smtp">[\s\S]*?<hostname>(.*?)<\/hostname>/)?.[1];
    const smtpPort = xml.match(/<outgoing type="smtp">[\s\S]*?<port>(.*?)<\/port>/)?.[1];

    if (imapHost && smtpHost) {
      return {
        host: imapHost,
        port: parseInt(imapPort || '993', 10),
        username: email,
        smtpHost,
        smtpPort: parseInt(smtpPort || '465', 10),
        smtpUsername: email
      };
    }
  } catch (error) {
    // Ignore errors and try next method
  }
  return null;
}

async function tryDnsSrv(domain: string, email: string): Promise<DiscoveredSettings | null> {
  try {
    const [imapSrv, smtpSrv] = await Promise.all([
      resolveSrv(`_imaps._tcp.${domain}`).catch(() => []),
      resolveSrv(`_submission._tcp.${domain}`).catch(() => [])
    ]);

    if (imapSrv.length && smtpSrv.length) {
      return {
        host: imapSrv[0].name,
        port: imapSrv[0].port,
        username: email,
        smtpHost: smtpSrv[0].name,
        smtpPort: smtpSrv[0].port,
        smtpUsername: email
      };
    }
  } catch (error) {
    // Ignore
  }
  return null;
}

function guessSettings(domain: string, email: string): DiscoveredSettings {
  return {
    host: `imap.${domain}`,
    port: 993,
    username: email,
    smtpHost: `smtp.${domain}`,
    smtpPort: 465,
    smtpUsername: email
  };
}
