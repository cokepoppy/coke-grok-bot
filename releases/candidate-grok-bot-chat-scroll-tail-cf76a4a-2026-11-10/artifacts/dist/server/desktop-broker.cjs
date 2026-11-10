"use strict";

// src/server/start-desktop-broker.ts
var import_promises2 = require("node:fs/promises");
var import_node_crypto3 = require("node:crypto");

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
var import_node_net = require("node:net");
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var desktopImageRef = /^coke-grok-desktop:(?:sha-[a-f0-9]{40}|candidate-[a-z0-9]+(?:-[a-z0-9]+)*)$/;
function desktopOwnerHash(session) {
  if (!uuid.test(session.tenantId) || !uuid.test(session.userId)) throw new Error("Invalid desktop identity");
  return (0, import_node_crypto.createHash)("sha256").update(`${session.tenantId.toLowerCase()}:${session.userId.toLowerCase()}`).digest("hex").slice(0, 32);
}
function desktopIdentity(session, signingKey) {
  if (signingKey.length < 32) throw new Error("Invalid desktop identity");
  const subject = `${session.tenantId.toLowerCase()}:${session.userId.toLowerCase()}`;
  const ownerHash = desktopOwnerHash(session);
  const token = (role) => (0, import_node_crypto.createHmac)("sha256", signingKey).update(`coke-grok-desktop:${role}:${subject}`).digest("base64url");
  return { namespace: `grok-user-${ownerHash}`, ownerHash, workerToken: token("worker"), agentToken: token("agent"), controlToken: token("control"), activeTabBridgeToken: token("active-tab-bridge") };
}
function desktopResources(identity, options) {
  if (!/^grok-user-[a-f0-9]{32}$/.test(identity.namespace) || !/^[a-f0-9]{32}$/.test(identity.ownerHash) || identity.namespace !== `grok-user-${identity.ownerHash}` || !/^[A-Za-z0-9_-]{43}$/.test(identity.workerToken) || !/^[A-Za-z0-9_-]{43}$/.test(identity.agentToken) || !/^[A-Za-z0-9_-]{43}$/.test(identity.controlToken) || !/^[A-Za-z0-9_-]{43}$/.test(identity.activeTabBridgeToken) || (/* @__PURE__ */ new Set([identity.workerToken, identity.agentToken, identity.controlToken, identity.activeTabBridgeToken])).size !== 4) throw new Error("Invalid desktop identity");
  if (!desktopImageRef.test(options.image) || !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(options.controlNamespace) || !options.gatewayCA.includes("BEGIN CERTIFICATE") || options.gatewayCA.length > 16384) throw new Error("Invalid desktop configuration");
  const proxyServer = options.desktopProxyServer?.trim(), proxyHostIp = options.desktopProxyHostIp?.trim(), proxyConfigured = options.desktopProxyServer !== void 0 || options.desktopProxyHostIp !== void 0;
  if (proxyConfigured && (proxyServer !== "http://host.docker.internal:17891" || proxyHostIp !== "192.168.65.254" || (0, import_node_net.isIP)(proxyHostIp || "") !== 4)) throw new Error("Invalid desktop proxy configuration");
  const ns = identity.namespace, labels = { "app.kubernetes.io/managed-by": "coke-grok-bot", "coke-grok-bot.io/owner-hash": identity.ownerHash };
  const meta = (name) => ({ name, namespace: ns, labels });
  const security = (uid, readOnlyRootFilesystem) => ({ runAsNonRoot: true, runAsUser: uid, runAsGroup: 1e3, allowPrivilegeEscalation: false, readOnlyRootFilesystem, capabilities: { drop: ["ALL"] } });
  const secretEnv = (name, key) => ({ name, valueFrom: { secretKeyRef: { name: "desktop-runtime", key } } });
  return [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: ns, labels } },
    { apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: meta("workspace"), spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "10Gi" } } } },
    { apiVersion: "v1", kind: "Secret", metadata: meta("desktop-runtime"), type: "Opaque", stringData: { worker: identity.workerToken, agent: identity.agentToken, control: identity.controlToken, activeTabBridge: identity.activeTabBridgeToken, activeTabBridgeConfig: `self.COKE_GROK_ACTIVE_TAB_BRIDGE_TOKEN=${JSON.stringify(identity.activeTabBridgeToken)};` } },
    { apiVersion: "v1", kind: "ConfigMap", metadata: meta("model-ca"), data: { "ca.pem": options.gatewayCA } },
    { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: meta("desktop-isolation"), spec: {
      podSelector: { matchLabels: { app: "grok-desktop" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": options.controlNamespace } } }], ports: [{ protocol: "TCP", port: 6080 }, { protocol: "TCP", port: 8082 }, { protocol: "TCP", port: 8083 }] }],
      egress: [
        { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] },
        { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": options.controlNamespace } }, podSelector: { matchLabels: { app: "coke-grok-auth" } } }], ports: [{ protocol: "TCP", port: 3002 }] },
        ...proxyConfigured ? [{ to: [{ ipBlock: { cidr: `${proxyHostIp}/32` } }], ports: [{ protocol: "TCP", port: 17891 }] }] : [],
        { to: [{ ipBlock: { cidr: "0.0.0.0/0", except: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "127.0.0.0/8"] } }], ports: [{ protocol: "TCP", port: 80 }, { protocol: "TCP", port: 443 }] }
      ]
    } },
    { apiVersion: "apps/v1", kind: "Deployment", metadata: meta("desktop"), spec: { replicas: 1, strategy: { type: "Recreate" }, selector: { matchLabels: { app: "grok-desktop" } }, template: { metadata: { labels: { ...labels, app: "grok-desktop" } }, spec: {
      automountServiceAccountToken: false,
      securityContext: { runAsNonRoot: true, fsGroup: 1e3, seccompProfile: { type: "RuntimeDefault" } },
      containers: [
        {
          name: "desktop",
          image: options.image,
          imagePullPolicy: "Never",
          env: [secretEnv("LINUX_DESKTOP_WORKER_TOKEN", "worker"), secretEnv("DOTS_AGENT_RUNTIME_TOKEN", "agent"), secretEnv("COKE_GROK_ACTIVE_TAB_BRIDGE_TOKEN", "activeTabBridge"), ...options.guarded ? [secretEnv("COKE_GROK_CONTROL_TOKEN", "control"), { name: "COKE_GROK_GUARDED_MODE", value: "1" }] : [], ...proxyConfigured ? [{ name: "COKE_DESKTOP_PROXY_SERVER", value: proxyServer }] : [], { name: "COKE_DESKTOP_VNC_AUTH_MODE", value: "gateway" }, { name: "COKE_DESKTOP_RESOLUTION", value: "1440x900" }, { name: "COKE_DESKTOP_SCREEN_SLOTS", value: "8" }, { name: "COKE_DESKTOP_CHROME_NO_SANDBOX", value: "1" }],
          securityContext: security(1e3, false),
          resources: { requests: { cpu: "200m", memory: "512Mi" }, limits: { cpu: "2", memory: "2Gi" } },
          ports: [{ name: "novnc", containerPort: 6080 }, { name: "worker", containerPort: 8082 }],
          startupProbe: { httpGet: { path: "/healthz", port: 8082 }, periodSeconds: 5, timeoutSeconds: 5, failureThreshold: 36 },
          readinessProbe: { httpGet: { path: "/readyz", port: 8082 }, periodSeconds: 5, timeoutSeconds: 5, failureThreshold: 2 },
          volumeMounts: [{ name: "workspace", mountPath: "/workspace" }, { name: "shm", mountPath: "/dev/shm" }, { name: "desktop-tmp", mountPath: "/tmp" }, { name: "active-tab-bridge", mountPath: "/opt/coke-grok/active-tab-extension/runtime-config.js", subPath: "runtime-config.js", readOnly: true }]
        },
        {
          name: "agent",
          image: options.image,
          imagePullPolicy: "Never",
          command: ["/bin/sh", "-c", "umask 0002; mkdir -p /tmp/agent-home; exec node /opt/coke-grok/agent-runtime.mjs"],
          env: [
            secretEnv("LINUX_DESKTOP_WORKER_TOKEN", "worker"),
            secretEnv("DOTS_AGENT_RUNTIME_TOKEN", "agent"),
            { name: "HOME", value: "/tmp/agent-home" },
            { name: "NODE_EXTRA_CA_CERTS", value: "/run/model-ca/ca.pem" },
            { name: "DOTS_DESKTOP_AGENT_ADAPTERS", value: "pi,dsh" },
            { name: "DOTS_AGENT_KERNELS_JSON", value: JSON.stringify({ pi: { command: "node", args: ["/opt/coke-dots/grok-kernel-adapter.mjs"] }, dsh: { command: "node", args: ["/opt/coke-dots/grok-kernel-adapter.mjs"] } }) }
          ],
          securityContext: security(1001, true),
          resources: { requests: { cpu: "50m", memory: "128Mi" }, limits: { cpu: "1", memory: "1Gi" } },
          ports: [{ name: "agent", containerPort: 8083 }],
          readinessProbe: { httpGet: { path: "/healthz", port: 8083 }, periodSeconds: 5, timeoutSeconds: 2 },
          volumeMounts: [{ name: "workspace", mountPath: "/workspace" }, { name: "agent-tmp", mountPath: "/tmp" }, { name: "model-ca", mountPath: "/run/model-ca", readOnly: true }]
        }
      ],
      volumes: [{ name: "workspace", persistentVolumeClaim: { claimName: "workspace" } }, { name: "shm", emptyDir: { medium: "Memory", sizeLimit: "512Mi" } }, { name: "desktop-tmp", emptyDir: { sizeLimit: "512Mi" } }, { name: "agent-tmp", emptyDir: { sizeLimit: "512Mi" } }, { name: "model-ca", configMap: { name: "model-ca" } }, { name: "active-tab-bridge", secret: { secretName: "desktop-runtime", items: [{ key: "activeTabBridgeConfig", path: "runtime-config.js" }], defaultMode: 288 } }]
    } } } },
    { apiVersion: "v1", kind: "Service", metadata: meta("desktop"), spec: { type: "ClusterIP", selector: { app: "grok-desktop" }, ports: [{ name: "novnc", port: 6080, targetPort: "novnc" }, { name: "worker", port: 8082, targetPort: "worker" }, { name: "agent", port: 8083, targetPort: "agent" }] } }
  ];
}
function splitDesktopResources(identity, options) {
  const agentImage = options.agentImage ?? options.image;
  if (!desktopImageRef.test(agentImage)) throw new Error("Invalid desktop configuration");
  const resources = structuredClone(desktopResources(identity, { ...options, image: options.image, guarded: true }));
  const ns = identity.namespace;
  const find = (kind, name) => {
    const resource = resources.find((item) => item.kind === kind && item.metadata?.name === name);
    if (!resource) throw new Error("Missing desktop resource");
    return resource;
  };
  const desktop = find("Deployment", "desktop"), pod = desktop.spec.template.spec;
  const [desktopContainer, agentContainer] = pod.containers;
  agentContainer.image = agentImage;
  desktopContainer.env.push({ name: "COKE_GROK_AGENT_URL", value: `http://agent.${ns}.svc.cluster.local:8083/` });
  agentContainer.env = agentContainer.env.filter((entry) => entry.name !== "LINUX_DESKTOP_WORKER_TOKEN");
  agentContainer.env.push({ name: "COKE_GROK_MEDIATED_COMPUTER", value: "1" });
  pod.containers = [desktopContainer];
  pod.volumes = pod.volumes.filter((volume) => ["workspace", "shm", "desktop-tmp", "active-tab-bridge"].includes(volume.name));
  const labels = { "app.kubernetes.io/managed-by": "coke-grok-bot", "coke-grok-bot.io/owner-hash": identity.ownerHash };
  const agentPod = {
    automountServiceAccountToken: false,
    securityContext: { runAsNonRoot: true, fsGroup: 1e3, seccompProfile: { type: "RuntimeDefault" } },
    affinity: { podAffinity: { requiredDuringSchedulingIgnoredDuringExecution: [{ labelSelector: { matchLabels: { app: "grok-desktop" } }, topologyKey: "kubernetes.io/hostname" }] } },
    containers: [agentContainer],
    volumes: [{ name: "workspace", persistentVolumeClaim: { claimName: "workspace" } }, { name: "agent-tmp", emptyDir: { sizeLimit: "512Mi" } }, { name: "model-ca", configMap: { name: "model-ca" } }]
  };
  const agentDeployment = { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "agent", namespace: ns, labels }, spec: { replicas: 1, strategy: { type: "Recreate" }, selector: { matchLabels: { app: "grok-agent" } }, template: { metadata: { labels: { ...labels, app: "grok-agent" } }, spec: agentPod } } };
  const desktopService = find("Service", "desktop");
  desktopService.spec.ports = desktopService.spec.ports.filter((port) => port.name !== "agent");
  const agentService = { apiVersion: "v1", kind: "Service", metadata: { name: "agent", namespace: ns, labels }, spec: { type: "ClusterIP", selector: { app: "grok-agent" }, ports: [{ name: "agent", port: 8083, targetPort: "agent" }] } };
  const desktopPolicy = find("NetworkPolicy", "desktop-isolation");
  desktopPolicy.spec.ingress = [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": options.controlNamespace } } }], ports: [{ protocol: "TCP", port: 6080 }, { protocol: "TCP", port: 8082 }] }];
  desktopPolicy.spec.egress = desktopPolicy.spec.egress.filter((entry) => !entry.to?.some((target) => target.podSelector?.matchLabels?.app === "coke-grok-auth"));
  desktopPolicy.spec.egress.push({ to: [{ podSelector: { matchLabels: { app: "grok-agent" } } }], ports: [{ protocol: "TCP", port: 8083 }] });
  const agentPolicy = { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: { name: "agent-isolation", namespace: ns, labels }, spec: {
    podSelector: { matchLabels: { app: "grok-agent" } },
    policyTypes: ["Ingress", "Egress"],
    ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": options.controlNamespace } } }, { podSelector: { matchLabels: { app: "grok-desktop" } } }], ports: [{ protocol: "TCP", port: 8083 }] }],
    egress: [
      { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] },
      { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": options.controlNamespace } }, podSelector: { matchLabels: { app: "coke-grok-auth" } } }], ports: [{ protocol: "TCP", port: 3002 }] }
    ]
  } };
  return [...resources, agentDeployment, agentService, agentPolicy];
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
var DesktopProvisioner = class {
  constructor(kube, signingKey, options) {
    this.kube = kube;
    this.signingKey = signingKey;
    this.options = options;
  }
  kube;
  signingKey;
  options;
  async connect(owner, signal) {
    if (signal.aborted) throw new Error("Desktop provisioning cancelled");
    const identity = desktopIdentity(owner, this.signingKey);
    if (this.options.bootstrap) {
      let namespace;
      try {
        namespace = await this.options.bootstrap.ensure(owner, signal);
      } catch (error) {
        if (error instanceof SafeDiagnosticError) throw error;
        throw new SafeDiagnosticError("NAMESPACE_BOOTSTRAP_FAILED");
      }
      if (namespace !== identity.namespace) throw new SafeDiagnosticError("OWNER_BINDING_MISMATCH");
    }
    const resources = this.options.split ? splitDesktopResources(identity, this.options) : desktopResources(identity, this.options);
    for (const expected of resources) {
      if (signal.aborted) throw new Error("Desktop provisioning cancelled");
      const kind = String(expected.kind), metadata = expected.metadata;
      if (kind === "Namespace" && this.options.bootstrap) continue;
      const namespace = kind === "Namespace" ? null : metadata.namespace || null;
      let actual;
      try {
        actual = await this.kube.get(kind, namespace, metadata.name, signal);
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
          actual = await this.kube.get(kind, namespace, metadata.name, signal);
        } catch {
          throw new SafeDiagnosticError("KUBERNETES_READ_FAILED");
        }
      }
      if (!actual) throw new SafeDiagnosticError("RESOURCE_MISSING");
      if (!matchesExpectedResource(expected, actual)) throw new SafeDiagnosticError("RESOURCE_MISMATCH");
    }
    try {
      if (this.options.split) await this.kube.waitForReady(identity.namespace, "agent", signal);
      await this.kube.waitForReady(identity.namespace, "desktop", signal);
    } catch {
      throw new SafeDiagnosticError("DESKTOP_NOT_READY");
    }
    return { agentUrl: new URL(`http://${this.options.split ? "agent" : "desktop"}.${identity.namespace}.svc.cluster.local:8083/`), agentToken: identity.agentToken };
  }
};
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

// src/server/desktop-provisioning-broker.ts
function createDesktopProvisioningBroker(tls, token, desktops) {
  return createOwnerRequestServer(tls, token, "/v1/personal-computer", async (owner, signal) => {
    const result = await desktops.connect(owner, signal);
    return { agentUrl: result.agentUrl.href, agentToken: result.agentToken };
  });
}

// src/server/namespace-bootstrap-client.ts
var import_node_https3 = require("node:https");
var NamespaceBootstrapClient = class {
  constructor(endpoint, ca, token) {
    this.ca = ca;
    this.token = token;
    this.endpoint = new URL(endpoint);
    if (this.endpoint.protocol !== "https:" || this.endpoint.username || this.endpoint.password || this.endpoint.pathname !== "/" || this.endpoint.search || this.endpoint.hash || !ca.length || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid namespace bootstrap service");
  }
  ca;
  token;
  endpoint;
  async ensure(owner, signal) {
    const expected = `grok-user-${desktopOwnerHash(owner)}`, body = Buffer.from(JSON.stringify({ tenantId: owner.tenantId, userId: owner.userId }));
    const result = await new Promise((resolve, reject) => {
      const req = (0, import_node_https3.request)(new URL("/v1/personal-namespace", this.endpoint), { method: "POST", ca: this.ca, headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", "content-length": body.length }, signal, timeout: 6e4 }, (res) => {
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 4096) {
            res.destroy();
            reject(new Error("Namespace bootstrap response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode || 0, data: Buffer.concat(chunks) }));
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error("Namespace bootstrap timed out")));
      req.on("error", reject);
      req.end(body);
    });
    if (result.status !== 200) throw new Error("Namespace bootstrap unavailable");
    let value;
    try {
      value = JSON.parse(result.data.toString("utf8"));
    } catch {
      throw new Error("Invalid namespace bootstrap response");
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join(",") !== "namespace" || value.namespace !== expected) throw new Error("Invalid namespace bootstrap response");
    return expected;
  }
};

// src/server/start-desktop-broker.ts
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
async function privateFile(name) {
  const path = required(name), metadata = await (0, import_promises2.stat)(path);
  if (!metadata.isFile() || (metadata.mode & 63) !== 0) throw new Error("Private broker file required");
  const value = await (0, import_promises2.readFile)(path);
  if (!value.length || value.length > 16384) throw new Error("Invalid broker file");
  return value;
}
async function main() {
  const namespace = required("COKE_GROK_CONTROL_NAMESPACE");
  const cert = await (0, import_promises2.readFile)(required("COKE_GROK_BROKER_TLS_CERT_FILE")), key = await privateFile("COKE_GROK_BROKER_TLS_KEY_FILE"), certificate = new import_node_crypto3.X509Certificate(cert);
  const host = `coke-grok-desktop-broker.${namespace}.svc.cluster.local`;
  if (!certificate.checkHost(host) || !certificate.checkPrivateKey((0, import_node_crypto3.createPrivateKey)(key)) || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw new Error("Invalid broker certificate");
  const capability = (await privateFile("COKE_GROK_BROKER_TOKEN_FILE")).toString("utf8").trim(), signingKey = await privateFile("COKE_GROK_DESKTOP_SIGNING_KEY_FILE");
  const ca = await (0, import_promises2.readFile)(required("COKE_GROK_KUBE_CA_FILE")), tokenFile = required("COKE_GROK_KUBE_TOKEN_FILE");
  const kube = new DesktopKubernetesClient(required("COKE_GROK_KUBE_URL"), ca, async () => (await (0, import_promises2.readFile)(tokenFile, "utf8")).trim());
  const bootstrapToken = (await privateFile("COKE_GROK_BOOTSTRAP_TOKEN_FILE")).toString("utf8").trim();
  if (bootstrapToken === capability) throw new Error("Broker and bootstrap capabilities must differ");
  const bootstrap = new NamespaceBootstrapClient(`https://coke-grok-namespace-bootstrap.${namespace}.svc.cluster.local:3004/`, await (0, import_promises2.readFile)(required("COKE_GROK_BOOTSTRAP_CA_FILE")), bootstrapToken);
  const provisioner = new DesktopProvisioner(kube, signingKey, { image: required("COKE_GROK_DESKTOP_IMAGE"), agentImage: required("COKE_GROK_AGENT_IMAGE"), controlNamespace: namespace, gatewayCA: await (0, import_promises2.readFile)(required("COKE_GROK_GATEWAY_TLS_CERT_FILE"), "utf8"), desktopProxyServer: process.env.COKE_GROK_DESKTOP_PROXY_SERVER?.trim() || void 0, desktopProxyHostIp: process.env.COKE_GROK_DESKTOP_PROXY_HOST_IP?.trim() || void 0, split: true, bootstrap });
  const server = createDesktopProvisioningBroker({ key, cert }, capability, provisioner);
  server.listen(3003, "0.0.0.0", () => console.log("Desktop provisioning broker listening on port 3003"));
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close());
}
main().catch(() => {
  console.error("Desktop provisioning broker failed to start; check private configuration and cluster access.");
  process.exitCode = 1;
});
