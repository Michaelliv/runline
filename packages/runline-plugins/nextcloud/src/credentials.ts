import { AuthError } from "runline";
import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A username and password (or app token) as HTTP Basic, on two targets of
 * the connection's HTTPS server: the WebDAV base it names, and the OCS
 * API beneath the server root, found before `/remote.php/`. A WebDAV URL
 * without that segment is refused: its OCS base cannot be known.
 */
export const nextcloudCredential = staticCredential({
  id: "nextcloud",
  auth: { kind: "basic" },
  local: { username: "username", password: "password" },
  targets: (config) => {
    const dav = httpsBase(config.webDavUrl, "");
    const root = dav.indexOf("/remote.php/");
    if (root < 0) throw new AuthError("invalid_credentials");
    return {
      dav: { baseUrl: dav, methods: ["DELETE", "MKCOL", "COPY", "MOVE"] },
      ocs: {
        baseUrl: `${dav.slice(0, root)}/ocs/`,
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["OCS-APIRequest"],
      },
    };
  },
});
