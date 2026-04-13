import type { RunlinePluginAPI } from "runline";

interface Conn { config: Record<string, unknown> }

function getConn(ctx: { connection: Conn }) {
  const c = ctx.connection.config;
  const url = (c.url as string).replace(/\/$/, "");
  return { url, username: c.username as string, password: c.password as string };
}

async function apiRequest(
  conn: { url: string; username: string; password: string },
  method: string,
  resource: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-NITRO-USER": conn.username,
      "X-NITRO-PASS": conn.password,
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(`${conn.url}/nitro/v1${resource}`, init);
  if (!res.ok) throw new Error(`Netscaler ADC API error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export default function netscalerAdc(rl: RunlinePluginAPI) {
  rl.setName("netscaler-adc");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "Netscaler ADC base URL (e.g. https://adc.example.com)", env: "NETSCALER_URL" },
    username: { type: "string", required: true, description: "Nitro API username", env: "NETSCALER_USERNAME" },
    password: { type: "string", required: true, description: "Nitro API password", env: "NETSCALER_PASSWORD" },
  });

  rl.registerAction("certificate.create", {
    description: "Create an SSL certificate on the appliance",
    inputSchema: {
      certificateFileName: { type: "string", required: true, description: "Name (and optional path) for the generated certificate file. Default path: /nsconfig/ssl/" },
      certificateFormat: { type: "string", required: true, description: "PEM or DER" },
      certificateType: { type: "string", required: true, description: "ROOT_CERT, INTM_CERT, SRVR_CERT, or CLNT_CERT" },
      certificateRequestFileName: { type: "string", required: true, description: "Name/path for the CSR file" },
      privateKeyFileName: { type: "string", required: false, description: "Private key file name (required for ROOT_CERT)" },
      caCertificateFileName: { type: "string", required: false, description: "CA certificate file (required for non-ROOT_CERT)" },
      caCertificateFileFormat: { type: "string", required: false, description: "PEM or DER (for CA cert)" },
      caPrivateKeyFileName: { type: "string", required: false, description: "CA private key file" },
      caPrivateKeyFileFormat: { type: "string", required: false, description: "PEM or DER (for CA key)" },
      caSerialFileNumber: { type: "string", required: false, description: "CA serial number file" },
      pempassphrase: { type: "string", required: false, description: "PEM passphrase for encrypted key" },
      subjectaltname: { type: "string", required: false, description: "Subject Alternative Name (SAN)" },
      days: { type: "string", required: false, description: "Validity period in days" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const conn = getConn(ctx);
      const body: Record<string, unknown> = {
        reqfile: p.certificateRequestFileName,
        certfile: p.certificateFileName,
        certform: p.certificateFormat,
        certType: p.certificateType,
      };
      if (p.certificateType === "ROOT_CERT") {
        if (p.privateKeyFileName) body.keyfile = p.privateKeyFileName;
      } else {
        if (p.caCertificateFileName) body.cacert = p.caCertificateFileName;
        if (p.caCertificateFileFormat) body.cacertform = p.caCertificateFileFormat;
        if (p.caPrivateKeyFileName) body.cakey = p.caPrivateKeyFileName;
        if (p.caPrivateKeyFileFormat) body.cakeyform = p.caPrivateKeyFileFormat;
        if (p.caSerialFileNumber) body.caserial = p.caSerialFileNumber;
      }
      if (p.pempassphrase) body.pempassphrase = p.pempassphrase;
      if (p.subjectaltname) body.subjectaltname = p.subjectaltname;
      if (p.days) body.days = p.days;
      await apiRequest(conn, "POST", "/config/sslcert?action=create", { sslcert: body });
      return { success: true };
    },
  });

  rl.registerAction("certificate.install", {
    description: "Install an SSL certificate-key pair on the appliance",
    inputSchema: {
      certificateKeyPairName: { type: "string", required: true, description: "Name for the certificate-key pair" },
      certificateFileName: { type: "string", required: true, description: "X509 certificate file name/path" },
      privateKeyFileName: { type: "string", required: true, description: "Private key file name/path" },
      certificateFormat: { type: "string", required: true, description: "PEM or DER" },
      password: { type: "string", required: false, description: "PEM passphrase (required for PEM format)" },
      certificateBundle: { type: "boolean", required: false, description: "Parse certificate chain as single file (PEM only)" },
      notifyExpiration: { type: "boolean", required: false, description: "Alert when certificate is about to expire" },
      notificationPeriod: { type: "number", required: false, description: "Days before expiry to alert (10-100, default 10)" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const conn = getConn(ctx);
      const body: Record<string, unknown> = {
        certkey: p.certificateKeyPairName,
        cert: p.certificateFileName,
        key: p.privateKeyFileName,
        inform: p.certificateFormat,
      };
      if (p.certificateFormat === "PEM") {
        if (p.password) body.passplain = p.password;
        body.bundle = p.certificateBundle ? "YES" : "NO";
      }
      if (p.notifyExpiration) {
        body.expirymonitor = "ENABLED";
        body.notificationperiod = p.notificationPeriod ?? 10;
      }
      await apiRequest(conn, "POST", "/config/sslcertkey", { sslcertkey: body });
      return { success: true };
    },
  });

  rl.registerAction("file.delete", {
    description: "Delete a file from the Netscaler ADC appliance",
    inputSchema: {
      fileName: { type: "string", required: true, description: "File name (without path)" },
      fileLocation: { type: "string", required: false, description: "File location (default /nsconfig/ssl/)" },
    },
    async execute(input, ctx) {
      const { fileName, fileLocation } = input as Record<string, unknown>;
      const conn = getConn(ctx);
      const loc = encodeURIComponent((fileLocation as string) ?? "/nsconfig/ssl/");
      await apiRequest(conn, "DELETE", `/config/systemfile?args=filename:${fileName},filelocation:${loc}`);
      return { success: true };
    },
  });
}
