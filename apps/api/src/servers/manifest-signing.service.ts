import { Injectable } from '@nestjs/common';
import { GameInstallManifest, SignedInstallManifest, canonicalInstallManifest } from '@lapis/contracts';
import { createPrivateKey, sign } from 'node:crypto';

const DEVELOPMENT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIHanzFIT19Lb3FahQNYfBNgUyqUcy6nEuRsJ8+/2sG4g
-----END PRIVATE KEY-----`;

@Injectable()
export class ManifestSigningService {
  private readonly keyId = process.env.LAPIS_MANIFEST_KEY_ID ?? 'lapis-dev-2026-01';
  private readonly privateKey = createPrivateKey((process.env.LAPIS_MANIFEST_PRIVATE_KEY ?? DEVELOPMENT_PRIVATE_KEY).replace(/\\n/g, '\n'));

  sign(payload: GameInstallManifest): SignedInstallManifest {
    return {
      keyId: this.keyId,
      payload,
      signature: sign(null, Buffer.from(canonicalInstallManifest(payload)), this.privateKey).toString('base64url'),
    };
  }
}
