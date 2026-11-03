import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT, GRAVITY } from '../core/config';

export type TagKind = 'terrain' | 'water' | 'static' | 'tree' | 'heli' | 'rotor' | 'tailrotor' | 'crate' | 'debris';
export interface Tag {
  kind: TagKind;
  part?: 'hull' | 'boom' | 'skids';
  ref?: unknown;
}

/** (self, other, force magnitude, selfHandle, otherHandle) */
export type ForceListener = (self: Tag, other: Tag, force: number, selfH: number, otherH: number) => void;
export type CollisionListener = (h1: number, h2: number, started: boolean) => void;

export class Physics {
  world: RAPIER.World;
  queue: RAPIER.EventQueue;
  tags = new Map<number, Tag>();
  forceListeners: ForceListener[] = [];
  collisionListeners: CollisionListener[] = [];

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.queue = new RAPIER.EventQueue(true);
  }

  step(): void {
    this.world.step(this.queue);
    this.queue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1(), h2 = ev.collider2();
      const t1 = this.tags.get(h1), t2 = this.tags.get(h2);
      if (!t1 || !t2) return;
      const f = ev.totalForceMagnitude();
      for (const l of this.forceListeners) { l(t1, t2, f, h1, h2); l(t2, t1, f, h2, h1); }
    });
    this.queue.drainCollisionEvents((h1, h2, started) => {
      for (const l of this.collisionListeners) l(h1, h2, started);
    });
  }

  addCollider(desc: RAPIER.ColliderDesc, tag: Tag, body?: RAPIER.RigidBody): RAPIER.Collider {
    const c = this.world.createCollider(desc, body);
    this.tags.set(c.handle, tag);
    return c;
  }

  removeBody(body: RAPIER.RigidBody): void {
    for (let i = 0; i < body.numColliders(); i++) this.tags.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  removeCollider(c: RAPIER.Collider): void {
    this.tags.delete(c.handle);
    this.world.removeCollider(c, true);
  }
}

export const yawQuat = (r: number) => ({ x: 0, y: Math.sin(r / 2), z: 0, w: Math.cos(r / 2) });
