/**
 * Free and disposable email domains: self-serve trials need a work email
 * (one trial per company email domain). Not exhaustive — it stops the common
 * cases; the per-farm limit and rate limits do the rest.
 */

export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Consumer mail
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'live.com', 'live.co.uk', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.co.jp', 'ymail.com', 'rocketmail.com', 'aol.com', 'aim.com',
  'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com', 'tuta.io', 'zoho.com', 'zohomail.com',
  'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru',
  'qq.com', '163.com', '126.com', 'sina.com', 'naver.com', 'daum.net', 'hanmail.net', 'rediffmail.com', 'fastmail.com', 'fastmail.fm',
  'hushmail.com', 'lycos.com', 'excite.com', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net',
  'btinternet.com', 'sky.com', 'virginmedia.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 't-online.de', 'libero.it',
  'bigpond.com', 'optusnet.com.au', 'xtra.co.nz', 'shaw.ca', 'rogers.com', 'sympatico.ca', 'hey.com', 'duck.com', 'skiff.com',
  // Disposable
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
  'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com',
  'mohmal.com', 'emailondeck.com', 'spamgourmet.com', 'mailnesia.com', 'tempail.com', 'burnermail.io', 'example.com', 'example.org', 'example.net',
])

/** The domain of an email address (lower case), or null. */
export function emailDomain(email: string): string | null {
  const m = /^[^\s@]+@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]{1,62})$/.exec(email.trim().toLowerCase())
  return m && m[1].length <= 253 ? m[1] : null
}

/** Whether the address is on a free or disposable mail domain (subdomains too). */
export function isFreeMailDomain(domain: string): boolean {
  const d = domain.toLowerCase()
  if (FREE_MAIL_DOMAINS.has(d)) return true
  for (const free of FREE_MAIL_DOMAINS) if (d.endsWith(`.${free}`)) return true
  return false
}
