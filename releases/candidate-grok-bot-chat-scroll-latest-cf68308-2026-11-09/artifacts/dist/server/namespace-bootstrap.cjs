"use strict";

// src/server/start-namespace-bootstrap.ts
var import_promises2 = require("node:fs/promises");
var import_node_crypto4 = require("node:crypto");

// src/server/desktop-kubernetes.ts
var import_node_https = require("node:https");
var import_promises = require("node:timers/promises");
var types = {
  Namespace: { path: "/api/v1/namespaces", namespaced: false },
  PersistentVolumeClaim: { path: "/api/v1/namespaces/{namespace}/persistentvolumeclaims", namespaced: true },
  Secret: { path: "/api/v1/namespaces/{namespace}/secrets", namespaced: true },
  ConfigMap: { path: "/api/v1/namespaces/{namespace}/configmaps", namespaced: true },
  NetworkPolicy: { path: "/apis/networking.k8s.io/v1/namespaces/{namespace}/networkpolicies", namespaced: true },
  Deployment: { path: "/apis/apps/v1/namespaces/{namespace}/deployments", namespaced: true },
  Service: { path: "/api/v1/namespaces/{namespace}/services", namespaced: true },
  RoleBinding: { path: "/apis/rbac.authorization.k8s.io/v1/namespaces/{namespace}/rolebindings", namespaced: true },
  ValidatingAdmissionPolicy: { path: "/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicies", namespaced: false },
  ValidatingAdmissionPolicyBinding: { path: "/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicybindings", namespaced: false }
};
var safeName = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/;
var DesktopKubernetesClient = class {
  constructor(endpoint, ca, token) {
    this.ca = ca;
    this.token = token;
    this.endpoint = new URL(endpoint);
    if (this.endpoint.protocol !== "https:" || this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash || this.endpoint.pathname !== "/" || !ca.length || typeof token === "string" && (!token || /[\r\n]/.test(token))) throw new Error("Invalid Kubernetes connection");
  }
  ca;
  token;
  endpoint;
  path(kind, namespace, name) {
    const entry = types[kind];
    if (!entry || entry.namespaced && (!namespace || !safeName.test(namespace)) || !entry.namespaced && namespace || name && !safeName.test(name)) throw new Error("Invalid Kubernetes resource identity");
    return entry.path.replace("{namespace}", namespace || "") + (name ? `/${name}` : "");
  }
  async call(method, path, body, signal, allowError = false) {
    const encoded = body ? Buffer.from(JSON.stringify(body)) : void 0;
    if (encoded && encoded.length > 1024 * 1024) throw new Error("Kubernetes object too large");
    const token = typeof this.token === "string" ? this.token : await this.token();
    if (!token || /[\r\n]/.test(token)) throw new Error("Invalid Kubernetes token");
    const result = await new Promise((resolve, reject) => {
      const request = (0, import_node_https.request)(new URL(path, this.endpoint), { method, ca: this.ca, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...encoded ? { "content-type": "application/json", "content-length": encoded.length } : {} }, signal, timeout: 15e3 }, (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) {
            response.destroy();
            reject(new Error("Kubernetes response too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status: response.statusCode || 0, data: Buffer.concat(chunks) }));
        response.on("error", reject);
      });
      request.on("timeout", () => request.destroy(new Error("Kubernetes request timed out")));
      request.on("error", reject);
      request.end(encoded);
    });
    if (method === "GET" && result.status === 404 || method === "POST" && result.status === 409) return { status: result.status, object: null };
    if ((result.status < 200 || result.status >= 300) && !allowError) throw new Error(`Kubernetes request failed (HTTP ${result.status})`);
    let object;
    try {
      object = JSON.parse(result.data.toString("utf8"));
    } catch {
      throw new Error("Invalid Kubernetes response");
    }
    if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error("Invalid Kubernetes response");
    return { status: result.status, object };
  }
  async get(kind, namespace, name, signal) {
    const result = await this.call("GET", this.path(kind, namespace, name), void 0, signal);
    return result.object;
  }
  async create(object, signal) {
    const metadata = object.metadata;
    const kind = String(object.kind || "");
    const result = await this.call("POST", this.path(kind, metadata?.namespace || null), object, signal);
    return result.status !== 409;
  }
  /** A successful or unrelated denial never counts as proof that the named admission policy is active. */
  async admissionDenies(object, policyName, bindingName, signal) {
    if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(policyName) || !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(bindingName) || !["Namespace", "RoleBinding"].includes(String(object.kind))) throw new Error("Invalid admission probe");
    const metadata = object.metadata, path = this.path(String(object.kind), metadata?.namespace || null) + "?dryRun=All";
    const result = await this.call("POST", path, object, signal, true), status = result.object;
    return result.status >= 400 && result.status < 500 && status?.kind === "Status" && status.status === "Failure" && typeof status.message === "string" && status.message.includes(`ValidatingAdmissionPolicy '${policyName}' with binding '${bindingName}' denied request`);
  }
  async waitForReady(namespace, name, signal) {
    const deadline = Date.now() + 18e4;
    while (Date.now() < deadline) {
      const deployment = await this.get("Deployment", namespace, name, signal);
      const meta = deployment?.metadata;
      const status = deployment?.status;
      if (meta?.deletionTimestamp) throw new Error("Desktop deployment is being removed");
      if (meta?.generation && status && (status.observedGeneration || 0) >= meta.generation && status.updatedReplicas === 1 && status.availableReplicas === 1 && status.replicas === 1) return;
      await (0, import_promises.setTimeout)(1500, void 0, { signal });
    }
    throw new Error("Desktop readiness timed out");
  }
};

// src/server/desktop-resources.ts
var import_node_crypto = require("node:crypto");
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function desktopOwnerHash(session) {
  if (!uuid.test(session.tenantId) || !uuid.test(session.userId)) throw new Error("Invalid desktop identity");
  return (0, import_node_crypto.createHash)("sha256").update(`${session.tenantId.toLowerCase()}:${session.userId.toLowerCase()}`).digest("hex").slice(0, 32);
}

// src/server/namespace-bootstrap-resources.ts
function namespaceBootstrapResources(options) {
  const name = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
  if (Object.values(options).some((value) => !name.test(value) || value.length > 50)) throw new Error("Invalid namespace bootstrap configuration");
  if (options.bootstrapServiceAccount === options.brokerServiceAccount || options.bootstrapRole === options.brokerRole) throw new Error("Bootstrap and broker identities must be distinct");
  const { controlNamespace, bootstrapServiceAccount, brokerServiceAccount, bootstrapRole, brokerRole, policyPrefix } = options;
  const principal = `system:serviceaccount:${controlNamespace}:${bootstrapServiceAccount}`;
  const match = [{ name: "bootstrap-identity", expression: `request.userInfo.username == ${JSON.stringify(principal)}` }];
  const namespaceValidation = [
    { expression: `object.metadata.name.matches('^grok-user-[a-f0-9]{32}$') && has(object.metadata.labels) && 'app.kubernetes.io/managed-by' in object.metadata.labels && object.metadata.labels['app.kubernetes.io/managed-by'] == 'coke-grok-bot' && 'coke-grok-bot.io/owner-hash' in object.metadata.labels && object.metadata.name == 'grok-user-' + object.metadata.labels['coke-grok-bot.io/owner-hash']`, message: "Only a labeled personal computer namespace may be created." },
    { expression: `!has(object.metadata.generateName) && !has(object.metadata.ownerReferences) && !has(object.metadata.finalizers) && !has(object.metadata.annotations) && object.metadata.labels.all(k, k in ['app.kubernetes.io/managed-by','coke-grok-bot.io/owner-hash','kubernetes.io/metadata.name'])`, message: "Namespace metadata must be limited to the personal computer identity." },
    { expression: `!has(object.spec) || !has(object.spec.finalizers) || object.spec.finalizers.all(f, f == 'kubernetes')`, message: "Custom namespace finalizers are not allowed." }
  ];
  const bindingValidation = [
    { expression: `request.namespace.matches('^grok-user-[a-f0-9]{32}$') && namespaceObject != null && has(namespaceObject.metadata.labels) && 'app.kubernetes.io/managed-by' in namespaceObject.metadata.labels && namespaceObject.metadata.labels['app.kubernetes.io/managed-by'] == 'coke-grok-bot' && 'coke-grok-bot.io/owner-hash' in namespaceObject.metadata.labels && request.namespace == 'grok-user-' + namespaceObject.metadata.labels['coke-grok-bot.io/owner-hash']`, message: "Binding requires a labeled personal computer namespace." },
    { expression: `object.metadata.name == 'desktop-provisioner' && !has(object.metadata.generateName) && !has(object.metadata.ownerReferences) && !has(object.metadata.finalizers) && !has(object.metadata.annotations) && object.roleRef.apiGroup == 'rbac.authorization.k8s.io' && object.roleRef.kind == 'ClusterRole' && object.roleRef.name == ${JSON.stringify(brokerRole)} && has(object.subjects) && object.subjects.size() == 1 && object.subjects[0].kind == 'ServiceAccount' && object.subjects[0].name == ${JSON.stringify(brokerServiceAccount)} && object.subjects[0].namespace == ${JSON.stringify(controlNamespace)}`, message: "Only the designated desktop broker may be bound to its fixed role." }
  ];
  const policy = (suffix, resourceRules, validations) => ({ apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingAdmissionPolicy", metadata: { name: `${policyPrefix}-${suffix}` }, spec: { failurePolicy: "Fail", matchConstraints: { matchPolicy: "Equivalent", namespaceSelector: {}, objectSelector: {}, resourceRules }, matchConditions: match, validations } });
  const binding = (suffix) => ({ apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingAdmissionPolicyBinding", metadata: { name: `${policyPrefix}-${suffix}` }, spec: { policyName: `${policyPrefix}-${suffix}`, validationActions: ["Deny"] } });
  return [
    // Apply policies and bindings before granting the bootstrap identity any cluster permissions.
    policy("namespace", [{ apiGroups: [""], apiVersions: ["v1"], operations: ["CREATE"], resources: ["namespaces"], scope: "Cluster" }], namespaceValidation),
    binding("namespace"),
    policy("binding", [{ apiGroups: ["rbac.authorization.k8s.io"], apiVersions: ["v1"], operations: ["CREATE"], resources: ["rolebindings"], scope: "Namespaced" }], bindingValidation),
    binding("binding"),
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: { name: brokerRole }, rules: [{ apiGroups: [""], resources: ["persistentvolumeclaims", "secrets", "configmaps", "services"], verbs: ["get", "create"] }, { apiGroups: ["apps"], resources: ["deployments"], verbs: ["get", "create"] }, { apiGroups: ["networking.k8s.io"], resources: ["networkpolicies"], verbs: ["get", "create"] }] },
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: { name: bootstrapRole }, rules: [{ apiGroups: [""], resources: ["namespaces"], verbs: ["get", "create"] }, { apiGroups: ["rbac.authorization.k8s.io"], resources: ["rolebindings"], resourceNames: ["desktop-provisioner"], verbs: ["get"] }, { apiGroups: ["rbac.authorization.k8s.io"], resources: ["rolebindings"], verbs: ["create"] }, { apiGroups: ["rbac.authorization.k8s.io"], resources: ["clusterroles"], resourceNames: [brokerRole], verbs: ["bind"] }, { apiGroups: ["admissionregistration.k8s.io"], resources: ["validatingadmissionpolicies", "validatingadmissionpolicybindings"], resourceNames: [`${policyPrefix}-namespace`, `${policyPrefix}-binding`], verbs: ["get"] }] },
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding", metadata: { name: bootstrapRole }, subjects: [{ kind: "ServiceAccount", name: bootstrapServiceAccount, namespace: controlNamespace }], roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: bootstrapRole } }
  ];
}
function personalDesktopBinding(namespace, options) {
  if (!/^grok-user-[a-f0-9]{32}$/.test(namespace) || Object.values(options).some((value) => !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value) || value.length > 50)) throw new Error("Invalid personal desktop binding");
  return { apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding", metadata: { name: "desktop-provisioner", namespace }, subjects: [{ kind: "ServiceAccount", name: options.brokerServiceAccount, namespace: options.controlNamespace }], roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: options.brokerRole } };
}

// src/server/safe-diagnostics.ts
var SafeDiagnosticError = class extends Error {
  constructor(diagnosticCode, status) {
    super(diagnosticCode);
    this.diagnosticCode = diagnosticCode;
    this.status = status;
    this.name = "SafeDiagnosticError";
  }
  diagnosticCode;
  status;
};
function safeDiagnosticMetadata(error) {
  if (!(error instanceof SafeDiagnosticError)) return { code: "INTERNAL_FAILURE" };
  const status = Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : void 0;
  return { code: error.diagnosticCode, ...status === void 0 ? {} : { status } };
}

// src/server/desktop-provisioner.ts
function matchesExpectedResource(expected, actual) {
  if (expected.kind !== actual.kind || expected.apiVersion !== actual.apiVersion) return false;
  const wanted = expected.metadata, found = actual.metadata;
  if (!wanted || !found || wanted.name !== found.name || wanted.namespace && wanted.namespace !== found.namespace || !isSubset(wanted.labels, found.labels)) return false;
  if (expected.kind === "Secret") {
    const values = expected.stringData, data = actual.data;
    return expected.type === actual.type && Boolean(values && data) && Object.entries(values).every(([key, value]) => typeof data[key] === "string" && data[key] === Buffer.from(value).toString("base64"));
  }
  if (expected.kind === "ConfigMap" && !isSubset(expected.data, actual.data)) return false;
  if (expected.kind === "RoleBinding") return isSubset(expected.roleRef, actual.roleRef) && isSubset(expected.subjects, actual.subjects);
  if (expected.spec === void 0) return true;
  if (expected.kind === "Deployment") return matchesDeploymentSpec(expected.spec, actual.spec);
  return isSubset(expected.spec, actual.spec);
}
function matchesDeploymentSpec(expected, actual) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected) || !actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const wanted = structuredClone(expected), found = actual;
  const expectedContainers = wanted.template?.spec?.containers, actualContainers = found.template?.spec?.containers;
  if (Array.isArray(expectedContainers) && Array.isArray(actualContainers)) for (const container of expectedContainers) {
    if (container?.name !== "desktop" || !Array.isArray(container.env)) continue;
    const deployed = actualContainers.find((item) => item?.name === "desktop");
    if (!Array.isArray(deployed?.env)) continue;
    const expectedSlots = container.env.find((item) => item?.name === "COKE_DESKTOP_SCREEN_SLOTS" && item?.value === "8");
    const deployedSlots = deployed.env.some((item) => item?.name === "COKE_DESKTOP_SCREEN_SLOTS");
    if (expectedSlots && !deployedSlots) container.env = container.env.filter((item) => item !== expectedSlots);
  }
  return isSubset(wanted, found);
}
function isSubset(expected, actual) {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => isSubset(value, actual[index]));
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => isSubset(value, actual[key]));
  }
  return expected === actual;
}

// src/server/namespace-bootstrap.ts
var NamespaceBootstrap = class {
  constructor(kube, options) {
    this.kube = kube;
    this.options = options;
  }
  kube;
  options;
  async ensure(owner, signal) {
    const ownerHash = desktopOwnerHash(owner), namespace = `grok-user-${ownerHash}`;
    if (this.options.verifyAdmission) try {
      await this.options.verifyAdmission(signal);
    } catch {
      throw new SafeDiagnosticError("BOOTSTRAP_ADMISSION_FAILED");
    }
    const expectedNamespace = { apiVersion: "v1", kind: "Namespace", metadata: { name: namespace, labels: { "app.kubernetes.io/managed-by": "coke-grok-bot", "coke-grok-bot.io/owner-hash": ownerHash } } };
    await this.ensureObject(expectedNamespace, null, signal);
    const { controlNamespace, brokerServiceAccount, brokerRole } = this.options;
    await this.ensureObject(personalDesktopBinding(namespace, { controlNamespace, brokerServiceAccount, brokerRole }), namespace, signal);
    return namespace;
  }
  async ensureObject(expected, namespace, signal) {
    if (signal.aborted) throw new Error("Namespace bootstrap cancelled");
    const kind = String(expected.kind), name = String(expected.metadata.name);
    let actual;
    try {
      actual = await this.kube.get(kind, namespace, name, signal);
    } catch {
      throw new SafeDiagnosticError("KUBERNETES_READ_FAILED");
    }
    if (!actual) {
      try {
        await this.kube.create(expected, signal);
      } catch {
        throw new SafeDiagnosticError("KUBERNETES_CREATE_FAILED");
      }
      try {
        actual = await this.kube.get(kind, namespace, name, signal);
      } catch {
        throw new SafeDiagnosticError("KUBERNETES_READ_FAILED");
      }
    }
    if (!actual) throw new SafeDiagnosticError("RESOURCE_MISSING");
    if (!matchesExpectedResource(expected, actual) || !safeMetadata(kind, actual)) throw new SafeDiagnosticError("RESOURCE_MISMATCH");
  }
};
function safeMetadata(kind, object) {
  const meta = object.metadata;
  if (!meta || meta.deletionTimestamp || meta.annotations && Object.keys(meta.annotations).length || meta.ownerReferences?.length || meta.finalizers?.length) return false;
  if (kind === "Namespace") {
    const labels = meta.labels || {}, allowed = /* @__PURE__ */ new Set(["app.kubernetes.io/managed-by", "coke-grok-bot.io/owner-hash", "kubernetes.io/metadata.name"]);
    if (Object.keys(labels).some((key) => !allowed.has(key))) return false;
    const spec = object.spec;
    if (spec?.finalizers?.some((value) => value !== "kubernetes")) return false;
  }
  return true;
}

// src/server/owner-request-server.ts
var import_node_https2 = require("node:https");
var import_node_crypto2 = require("node:crypto");
var uuid2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createOwnerRequestServer(tls, token, path, handle) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^\/v1\/[a-z-]+$/.test(path)) throw new Error("Invalid internal service configuration");
  const expected = Buffer.from(`Bearer ${token}`);
  let active = 0;
  const server = (0, import_node_https2.createServer)(tls, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const authorization = Buffer.from(req.headers.authorization || "");
    if (authorization.length !== expected.length || !(0, import_node_crypto2.timingSafeEqual)(authorization, expected)) {
      res.writeHead(401);
      return res.end();
    }
    if (req.method !== "POST" || req.url !== path) {
      res.writeHead(404);
      return res.end();
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
      res.writeHead(415);
      return res.end();
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024) {
          res.writeHead(413);
          return res.end();
        }
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400);
        return res.end();
      }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "tenantId,userId") {
        res.writeHead(400);
        return res.end();
      }
      const { tenantId, userId } = body;
      if (typeof tenantId !== "string" || !uuid2.test(tenantId) || typeof userId !== "string" || !uuid2.test(userId)) {
        res.writeHead(400);
        return res.end();
      }
      if (active >= 4) {
        res.writeHead(503);
        return res.end();
      }
      active++;
      try {
        const result = await handle({ tenantId, userId }, AbortSignal.timeout(21e4));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify(result));
      } catch (error) {
        console.error("Owner-scoped internal service failed", { path, ...safeDiagnosticMetadata(error) });
        if (!res.headersSent) res.writeHead(503);
        return res.end();
      } finally {
        active--;
      }
    } catch {
      if (!res.headersSent) res.writeHead(503);
      return res.end();
    }
  });
  server.headersTimeout = 1e4;
  server.requestTimeout = 15e3;
  return server;
}

// src/server/namespace-bootstrap-service.ts
function createNamespaceBootstrapService(tls, token, bootstrap) {
  return createOwnerRequestServer(tls, token, "/v1/personal-namespace", async (owner, signal) => ({ namespace: await bootstrap.ensure(owner, signal) }));
}

// src/server/namespace-admission-preflight.ts
var import_node_crypto3 = require("node:crypto");
var NamespaceAdmissionPreflight = class {
  constructor(kube, options) {
    this.kube = kube;
    this.options = options;
    if (Object.values(options).some((value) => !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value) || value.length > 50)) throw new Error("Invalid admission preflight configuration");
    if (options.bootstrapServiceAccount === options.brokerServiceAccount || options.bootstrapRole === options.brokerRole) throw new Error("Invalid admission preflight configuration");
  }
  kube;
  options;
  async verify(signal) {
    if (signal.aborted) throw new Error("Admission preflight cancelled");
    const expected = namespaceBootstrapResources(this.options);
    for (const kind of ["ValidatingAdmissionPolicy", "ValidatingAdmissionPolicyBinding"]) for (const suffix of ["namespace", "binding"]) {
      const name = `${this.options.policyPrefix}-${suffix}`, wanted = expected.find((item) => item.kind === kind && item.metadata.name === name), actual = await this.kube.get(kind, null, name, signal);
      if (!wanted || !actual || actual.apiVersion !== wanted.apiVersion || actual.kind !== kind || actual.metadata?.name !== name || !equal(actual.spec, wanted.spec)) throw new Error("Admission policy does not match expected configuration");
    }
    const invalidNamespace = { apiVersion: "v1", kind: "Namespace", metadata: { name: `grok-probe-${(0, import_node_crypto3.randomBytes)(12).toString("hex")}` } };
    const policy = `${this.options.policyPrefix}-namespace`;
    if (!await this.kube.admissionDenies(invalidNamespace, policy, policy, signal)) throw new Error("Namespace admission is not confirmed");
    const target = `grok-user-${(0, import_node_crypto3.randomBytes)(16).toString("hex")}`, binding = personalDesktopBinding(target, this.options);
    binding.metadata.namespace = this.options.controlNamespace;
    binding.subjects[0].name = this.options.brokerServiceAccount === "bootstrap-probe" ? "other-probe" : "bootstrap-probe";
    const bindingPolicy = `${this.options.policyPrefix}-binding`;
    if (!await this.kube.admissionDenies(binding, bindingPolicy, bindingPolicy, signal)) throw new Error("Role binding admission is not confirmed");
  }
};
function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && equal(a[k], b[k]));
}

// src/server/start-namespace-bootstrap.ts
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
async function privateFile(name) {
  const path = required(name), metadata = await (0, import_promises2.stat)(path);
  if (!metadata.isFile() || (metadata.mode & 63) !== 0) throw new Error("Private bootstrap file required");
  const value = await (0, import_promises2.readFile)(path);
  if (!value.length || value.length > 16384) throw new Error("Invalid bootstrap file");
  return value;
}
async function main() {
  const namespace = required("COKE_GROK_CONTROL_NAMESPACE"), cert = await (0, import_promises2.readFile)(required("COKE_GROK_BOOTSTRAP_TLS_CERT_FILE")), key = await privateFile("COKE_GROK_BOOTSTRAP_TLS_KEY_FILE"), certificate = new import_node_crypto4.X509Certificate(cert);
  const host = `coke-grok-namespace-bootstrap.${namespace}.svc.cluster.local`;
  if (!certificate.checkHost(host) || !certificate.checkPrivateKey((0, import_node_crypto4.createPrivateKey)(key)) || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw new Error("Invalid bootstrap certificate");
  const token = (await privateFile("COKE_GROK_BOOTSTRAP_TOKEN_FILE")).toString("utf8").trim(), ca = await (0, import_promises2.readFile)(required("COKE_GROK_KUBE_CA_FILE")), tokenFile = required("COKE_GROK_KUBE_TOKEN_FILE");
  const kube = new DesktopKubernetesClient(required("COKE_GROK_KUBE_URL"), ca, async () => (await (0, import_promises2.readFile)(tokenFile, "utf8")).trim());
  const options = { controlNamespace: namespace, bootstrapServiceAccount: required("COKE_GROK_BOOTSTRAP_SERVICE_ACCOUNT"), brokerServiceAccount: required("COKE_GROK_BROKER_SERVICE_ACCOUNT"), bootstrapRole: required("COKE_GROK_BOOTSTRAP_ROLE"), brokerRole: required("COKE_GROK_BROKER_ROLE"), policyPrefix: required("COKE_GROK_BOOTSTRAP_POLICY_PREFIX") };
  const preflight = new NamespaceAdmissionPreflight(kube, options);
  await preflight.verify(AbortSignal.timeout(3e4));
  const bootstrap = new NamespaceBootstrap(kube, { ...options, verifyAdmission: (signal) => preflight.verify(signal) });
  const server = createNamespaceBootstrapService({ key, cert }, token, bootstrap);
  server.listen(3004, "0.0.0.0", () => console.log("Namespace bootstrap service listening on port 3004"));
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close());
}
main().catch(() => {
  console.error("Namespace bootstrap failed to start; check private configuration and cluster access.");
  process.exitCode = 1;
});
