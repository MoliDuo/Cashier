import crypto from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

type CBORValue = Parameters<typeof isoCBOR.encode>[0];

function b64(bytes: Uint8Array): string {
  return isoBase64URL.fromBuffer(new Uint8Array(bytes));
}

/**
 * A software passkey: an ES256 key pair that answers WebAuthn ceremonies the
 * way a platform authenticator would, with "none" attestation.
 */
export class TestAuthenticator {
  readonly credentialId = crypto.randomBytes(16);
  private readonly keys = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  private userHandle: string | undefined;
  counter = 0;

  constructor(
    private readonly rpId = "localhost",
    private readonly origin = "http://localhost:3000"
  ) {}

  get id(): string {
    return b64(this.credentialId);
  }

  private authData(flags: number, extra: Uint8Array = new Uint8Array()): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    return Buffer.concat([
      crypto.createHash("sha256").update(this.rpId).digest(),
      Buffer.from([flags]),
      counter,
      extra,
    ]);
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  register(options: PublicKeyCredentialCreationOptionsJSON): RegistrationResponseJSON {
    this.userHandle = options.user.id;
    const jwk = this.keys.publicKey.export({ format: "jwk" });
    const coseKey = isoCBOR.encode(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x!)],
        [-3, isoBase64URL.toBuffer(jwk.y!)],
      ]) as CBORValue
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = this.authData(
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_CREDENTIAL,
      Buffer.concat([Buffer.alloc(16), idLength, this.credentialId, coseKey])
    );
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", new Uint8Array(authData)],
      ]) as CBORValue
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64(this.clientData("webauthn.create", options.challenge, this.origin)),
        attestationObject: b64(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Signs in; the counter advances unless the test pins it. */
  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    overrides: { counter?: number; origin?: string } = {}
  ): AuthenticationResponseJSON {
    this.counter = overrides.counter ?? this.counter + 1;
    const authData = this.authData(FLAG_USER_PRESENT | FLAG_USER_VERIFIED);
    const clientDataJSON = this.clientData(
      "webauthn.get",
      options.challenge,
      overrides.origin ?? this.origin
    );
    const signature = crypto.sign(
      "sha256",
      Buffer.concat([authData, crypto.createHash("sha256").update(clientDataJSON).digest()]),
      this.keys.privateKey
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(signature),
        ...(this.userHandle != null ? { userHandle: this.userHandle } : {}),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
