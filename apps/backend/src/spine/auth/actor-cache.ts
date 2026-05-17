/**
 * Actor cache — Redis-A backed, 5-minute TTL.
 *
 * Key format: `actor:{source}:{actorId}` where `source` is 'mobile' | 'admin'.
 * The source discriminator prevents collisions when a mobile User and an
 * AdminUser share the same id value (different tables, both UUIDs/CUIDs).
 *
 * The cache stores the Actor JSON with capabilities flattened to an array
 * (Set is not JSON-serializable); `deserialize` rehydrates back into a Set.
 *
 * Invalidation is explicit — there is no background sweep. Five call sites
 * are documented in docs/PHASE_1A_IMPLEMENTATION.md §"Actor cache"; 5-min
 * TTL is the floor on staleness for missed invalidations.
 */

import { redis } from '../../lib/redis';
import { logger } from '../../lib/logger';
import type { Actor, ActorType, Capability, ScopeContext, SessionContext } from 'shared';
import { isActorType } from 'shared';

export type ActorSource = 'mobile' | 'admin';

export const ACTOR_CACHE_TTL_SECONDS = 5 * 60;

const buildKey = (source: ActorSource, actorId: string): string =>
  `actor:${source}:${actorId}`;

interface SerializedActor {
  actorId: string;
  actorType: ActorType;
  capabilities: readonly string[];
  scope: ScopeContext;
  sessionContext: SessionContext;
}

const serialize = (actor: Actor): SerializedActor => ({
  actorId: actor.actorId,
  actorType: actor.actorType,
  capabilities: [...actor.capabilities],
  scope: actor.scope,
  sessionContext: actor.sessionContext,
});

const deserialize = (raw: string): Actor | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<SerializedActor>;
  if (
    typeof candidate.actorId !== 'string'
    || !isActorType(candidate.actorType)
    || !Array.isArray(candidate.capabilities)
    || typeof candidate.scope !== 'object' || candidate.scope === null
    || typeof candidate.sessionContext !== 'object' || candidate.sessionContext === null
  ) {
    return null;
  }
  return {
    actorId: candidate.actorId,
    actorType: candidate.actorType,
    capabilities: new Set(candidate.capabilities as readonly Capability[]),
    scope: candidate.scope as ScopeContext,
    sessionContext: candidate.sessionContext as SessionContext,
  };
};

export const actorCache = {
  async get(source: ActorSource, actorId: string): Promise<Actor | null> {
    try {
      const raw = await redis.get(buildKey(source, actorId));
      if (!raw) return null;
      return deserialize(raw);
    } catch (error) {
      logger.warn({
        event: 'actor_cache_read_failed',
        source: 'SYSTEM',
        meta: { actorSource: source, actorId, error: String(error) },
      });
      return null;
    }
  },

  async set(source: ActorSource, actor: Actor): Promise<void> {
    try {
      await redis.setex(
        buildKey(source, actor.actorId),
        ACTOR_CACHE_TTL_SECONDS,
        JSON.stringify(serialize(actor)),
      );
    } catch (error) {
      logger.warn({
        event: 'actor_cache_write_failed',
        source: 'SYSTEM',
        meta: { actorSource: source, actorId: actor.actorId, error: String(error) },
      });
    }
  },

  async invalidate(source: ActorSource, actorId: string): Promise<void> {
    try {
      await redis.del(buildKey(source, actorId));
    } catch (error) {
      logger.warn({
        event: 'actor_cache_invalidate_failed',
        source: 'SYSTEM',
        meta: { actorSource: source, actorId, error: String(error) },
      });
    }
  },
};
