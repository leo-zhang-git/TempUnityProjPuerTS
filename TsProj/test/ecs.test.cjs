const assert = require("node:assert/strict");
const { defineComponent } = require("../dist/ecs/component.js");
const { SystemBase, SystemGroup } = require("../dist/ecs/system.js");
const { World } = require("../dist/ecs/world.js");
const { GameRuntime } = require("../dist/game/game-runtime.js");

function testWorldLifecycle() {
  const Position = defineComponent("test.position", () => ({ x: 0, y: 0 }));
  const Velocity = defineComponent("test.velocity", () => ({ x: 1, y: 2 }));
  const SameNameDifferentType = defineComponent("test.position", () => ({ value: 1 }));
  const world = new World();
  const entity = world.createEntity();

  const position = world.emplace(entity, Position);
  position.x = 10;
  world.emplace(entity, Velocity);
  world.emplace(entity, SameNameDifferentType);

  assert.equal(world.get(entity, Position).x, 10);
  assert.equal(world.get(entity, SameNameDifferentType).value, 1);
  assert.deepEqual(world.query(Position, Velocity), [
    [entity, position, world.get(entity, Velocity)]
  ]);
  assert.throws(
    () => world.add(entity, Position, { x: 20, y: 20 }),
    /already has component/
  );

  const otherWorld = new World();
  otherWorld.createEntity();
  assert.throws(() => otherWorld.get(entity, Position), /not alive in this world/);

  world.destroyEntity(entity);
  assert.equal(world.isAlive(entity), false);
  assert.throws(() => world.get(entity, Position), /not alive in this world/);

  world.dispose();
  assert.throws(() => world.createEntity(), /World has been disposed/);
  otherWorld.dispose();
}

function testSystemLifecycle() {
  const events = [];

  class TrackingSystem extends SystemBase {
    constructor(name) {
      super(name);
    }

    onInitialize() {
      events.push(`initialize:${this.name}`);
    }

    onUpdate(_world, deltaTime) {
      events.push(`update:${this.name}:${deltaTime}`);
    }

    onDispose() {
      events.push(`dispose:${this.name}`);
    }
  }

  const world = new World();
  const group = new SystemGroup("test", [
    new TrackingSystem("first"),
    new TrackingSystem("second")
  ]);

  assert.throws(() => group.update(world, 0), /not initialized/);
  group.initialize(world);
  group.update(world, 0.25);
  group.dispose(world);
  group.dispose(world);

  assert.deepEqual(events, [
    "initialize:first",
    "initialize:second",
    "update:first:0.25",
    "update:second:0.25",
    "dispose:second",
    "dispose:first"
  ]);
  assert.throws(() => group.update(world, 0), /not initialized/);
  world.dispose();
}

function testSystemInitializationRollback() {
  const events = [];

  class ReadySystem extends SystemBase {
    constructor() {
      super("ready");
    }

    onInitialize() {
      events.push("initialize:ready");
    }

    onUpdate() {}

    onDispose() {
      events.push("dispose:ready");
    }
  }

  class FailingSystem extends SystemBase {
    constructor() {
      super("failing");
    }

    onInitialize() {
      events.push("initialize:failing");
      throw new Error("expected initialization failure");
    }

    onUpdate() {}

    onDispose() {
      events.push("dispose:failing");
    }
  }

  const world = new World();
  const group = new SystemGroup("rollback", [
    new ReadySystem(),
    new FailingSystem()
  ]);

  assert.throws(() => group.initialize(world), /expected initialization failure/);
  assert.deepEqual(events, [
    "initialize:ready",
    "initialize:failing",
    "dispose:failing",
    "dispose:ready"
  ]);
  assert.throws(() => group.update(world, 0), /not initialized/);
  world.dispose();
}

function testGameRuntimePhases() {
  const runtime = new GameRuntime();

  assert.throws(() => runtime.enterMain(), /expected bootInitialized/);
  assert.throws(() => runtime.update(0.1), /expected main/);
  assert.equal(runtime.initializeBoot(), "Boot initialized.");
  assert.throws(() => runtime.initializeBoot(), /expected created/);
  assert.equal(runtime.enterMain(), "Main entered.");
  runtime.fixedUpdate(0.02);
  runtime.update(0.1);
  runtime.lateUpdate(0.1);
  runtime.dispose();
  runtime.dispose();
  assert.throws(() => runtime.update(0.1), /expected main/);
}

testWorldLifecycle();
testSystemLifecycle();
testSystemInitializationRollback();
testGameRuntimePhases();

console.log("ECS lifecycle tests passed.");
