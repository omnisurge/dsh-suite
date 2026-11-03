/** One shared readiness predicate for the Suite development page.
 *
 * It is the only place that decides whether a published generation counts as applied. The page, the
 * isolated tests and the withdrawal variants all consume it, so no consumer can hold a second,
 * weaker notion of "ready": a matching byte revision alone is never enough, and a generation whose
 * protocol or running capability is unproven is reported as needing a full builder upgrade. */
import {SUITE_DEVELOPMENT_PROTOCOL,REQUIRED_CAPABILITIES,CAPABILITY_OWNERS} from '../../../scripts/shared/build-protocol.mjs';
// Client bundling fixes this canonical source into the produced generation snapshot.
export const REQUIRED_READINESS_CAPABILITIES = REQUIRED_CAPABILITIES;
export function developmentReadiness(status, client) {
 const operation = status?.operation, target = operation?.target;
 if (operation?.phase === 'building') return 'building';
 if (operation?.phase === 'failed') return 'failed';
 if (operation?.phase !== 'published' || !target) return 'idle';
 const protocol = status?.managerProtocol;
 const targetCapable = REQUIRED_READINESS_CAPABILITIES.every(name => target.capabilities?.[name] === true);
 const protocolReady = protocol === SUITE_DEVELOPMENT_PROTOCOL && target.protocol === protocol && status?.hostProtocol === protocol && client?.protocol === protocol;
 const runtimeCapable = REQUIRED_CAPABILITIES.every(name => (CAPABILITY_OWNERS[name] === 'host' ? status?.hostCapabilities : client?.capabilities)?.[name] === true);
 if (!targetCapable || !protocolReady || !runtimeCapable) return 'builderStale';
 if (status.hostRevision === target.hostRevision && client?.revision === target.clientRevision) return 'applied';
 if (!status.hostHmr && status.hostRevision !== target.hostRevision) return 'restart';
 return 'waiting';
}
