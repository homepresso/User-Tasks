import type { EsignProviderId } from '../catalog'
import type { EsignAdapter } from '../adapter'
import { docusignAdapter } from './docusign'
import { adobeSignAdapter } from './adobe-sign'
import { dropboxSignAdapter } from './dropbox-sign'
import { pandadocAdapter } from './pandadoc'
import { signnowAdapter } from './signnow'
import { boldsignAdapter } from './boldsign'

const ADAPTERS: Record<EsignProviderId, EsignAdapter> = {
  docusign: docusignAdapter,
  adobe_sign: adobeSignAdapter,
  dropbox_sign: dropboxSignAdapter,
  pandadoc: pandadocAdapter,
  signnow: signnowAdapter,
  boldsign: boldsignAdapter,
}

export function getEsignAdapter(id: EsignProviderId): EsignAdapter {
  const adapter = ADAPTERS[id]
  if (!adapter) throw new Error(`Unknown e-signature provider: ${id}`)
  return adapter
}
