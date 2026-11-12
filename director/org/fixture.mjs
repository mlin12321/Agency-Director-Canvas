/**
 * A deterministic ~500-node org tree for developing the UI and exercising the
 * stream before real pods exist. No agent in it has a live conversation.
 *
 * @import { AgentRef, NodeHealth } from "../../src/api/director/types.ts"
 * @import { OrgNodeInput } from "./org-store.mjs"
 */

const DOMAINS = [
  "platform",
  "payments",
  "identity",
  "search",
  "growth",
  "data",
];
const SERVICES = ["api", "worker", "storage", "gateway", "console"];
const MODULES_PER_SERVICE = 15;

/** Weighted so most of the tree is healthy and a few nodes need attention. */
const HEALTH_WHEEL = /** @type {NodeHealth[]} */ ([
  "converging",
  "converging",
  "converging",
  "converging",
  "done",
  "done",
  "negotiating_split",
  "needs_attention",
  "collision",
  "pruned",
]);

/** Small deterministic PRNG (mulberry32) so the fixture never changes. */
function createRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {boolean} leaf @returns {AgentRef[]} */
function pod(leaf) {
  /** @type {AgentRef[]} */
  const agents = [
    { role: "lead_ic", conversationId: null, status: "running" },
    { role: "manager", conversationId: null, status: "idle" },
    { role: "reviewer", conversationId: null, status: "idle" },
  ];
  if (leaf) {
    agents.push({ role: "worker", conversationId: null, status: "running" });
  }
  return agents;
}

/**
 * @returns {OrgNodeInput[]} Parents before children.
 */
export function buildFixtureNodes() {
  const random = createRandom(20261111);
  const pick = () => HEALTH_WHEEL[Math.floor(random() * HEALTH_WHEEL.length)];

  /** @type {OrgNodeInput[]} */
  const nodes = [
    {
      id: "root",
      parentId: null,
      title: "Root organization",
      boundary: { path: "", writable: [], readonly: ["**"] },
      isolation: "worktree",
      worktreePath: ".",
      branch: "main",
      agents: pod(false),
      health: "converging",
      specSummary: "Owns cross-domain contracts and the release plan.",
    },
  ];

  DOMAINS.forEach((domain) => {
    const domainPath = `services/${domain}`;
    nodes.push({
      id: domain,
      parentId: "root",
      title: `${domain} domain`,
      boundary: {
        path: domainPath,
        writable: [`${domainPath}/*.md`],
        readonly: ["src/types/**"],
      },
      isolation: "worktree",
      worktreePath: `.worktrees/${domain}`,
      branch: `agents/${domain}`,
      agents: pod(false),
      health: pick(),
      specSummary: `Interface contracts between the ${domain} services.`,
    });

    SERVICES.forEach((service) => {
      const serviceId = `${domain}.${service}`;
      const servicePath = `${domainPath}/${service}`;
      nodes.push({
        id: serviceId,
        parentId: domain,
        title: `${domain}/${service}`,
        boundary: {
          path: servicePath,
          writable: [`${servicePath}/*.ts`],
          readonly: [`${domainPath}/contracts/**`],
        },
        isolation: "worktree",
        worktreePath: `.worktrees/${domain}-${service}`,
        branch: `agents/${domain}/${service}`,
        agents: pod(false),
        health: pick(),
        specSummary: `Implements the ${service} service for ${domain}.`,
      });

      for (let index = 1; index <= MODULES_PER_SERVICE; index += 1) {
        const moduleName = `module-${String(index).padStart(2, "0")}`;
        const modulePath = `${servicePath}/${moduleName}`;
        nodes.push({
          id: `${serviceId}.${moduleName}`,
          parentId: serviceId,
          title: moduleName,
          boundary: {
            path: modulePath,
            writable: [`${modulePath}/**`],
            readonly: [`${servicePath}/*.ts`],
          },
          // Module workers collaborate inside their service's worktree.
          isolation: "shared",
          worktreePath: `.worktrees/${domain}-${service}`,
          branch: `agents/${domain}/${service}`,
          agents: pod(true),
          health: pick(),
          specSummary: `Leaf module ${index} of ${domain}/${service}.`,
        });
      }
    });
  });

  return nodes;
}
