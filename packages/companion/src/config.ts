import fs from "node:fs";
import tls from "node:tls";

function readRegularPem(filePath: string, label: string): Buffer {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`${label} path does not exist or is not readable.`);
  }
  if (!stat.isFile())
    throw new Error(`${label} path must be a PEM file, not a directory.`);
  try {
    const contents = fs.readFileSync(filePath);
    if (
      !contents.includes(Buffer.from("-----BEGIN CERTIFICATE-----")) &&
      label !== "Private key"
    ) {
      throw new Error();
    }
    return contents;
  } catch {
    throw new Error(`${label} path must be a readable PEM file.`);
  }
}

export function validateTlsFiles(
  certPath: string,
  keyPath: string,
  caPath: string,
): void {
  const cert = readRegularPem(certPath, "TLS certificate");
  const key = readRegularPem(keyPath, "Private key");
  const ca = readRegularPem(caPath, "CA certificate");
  try {
    tls.createSecureContext({ cert, key, ca });
  } catch {
    throw new Error(
      "TLS certificate, private key, or CA PEM is invalid or the key does not match the certificate.",
    );
  }
}
