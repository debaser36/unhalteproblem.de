import { assert, describe, it } from "@effect/vitest";
import { DateTime, Option } from "effect";
import {
  logIn,
  register,
  type UserProfile,
  UserId,
  UserProfileChanged,
  UserRegistered,
} from "./User.ts";

const id = UserId.make("8f3c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b");
const t0 = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const t1 = DateTime.makeUnsafe("2026-01-02T00:00:00Z");

const profile: UserProfile = {
  username: Option.some("ada"),
  name: Option.some("Ada Lovelace"),
  email: Option.some("ada@example.org"),
  emailVerified: true,
};

const registered = register({ id, subject: "kc-1", profile, now: t0 }).user;

describe("User", () => {
  it("registers a user with the profile and the time of the first login", () => {
    const { user, roles, events } = register({
      id,
      subject: "kc-1",
      profile,
      now: t0,
    });
    assert.deepStrictEqual(roles, ["normalUser"]);
    assert.strictEqual(user.id, id);
    assert.strictEqual(user.subject, "kc-1");
    assert.deepStrictEqual(user.username, Option.some("ada"));
    assert.isTrue(user.emailVerified);
    assert.isTrue(DateTime.Equivalence(user.createdAt, t0));
    assert.isTrue(DateTime.Equivalence(user.updatedAt, t0));
    assert.isTrue(DateTime.Equivalence(user.lastLoginAt, t0));
    assert.deepStrictEqual(events, [new UserRegistered({ userId: id })]);
  });

  it("a login with an unchanged profile only moves the last login", () => {
    const { user, events } = logIn(registered, profile, t1);
    assert.isTrue(DateTime.Equivalence(user.lastLoginAt, t1));
    assert.isTrue(DateTime.Equivalence(user.updatedAt, t0));
    assert.deepStrictEqual(events, []);
  });

  it("a login with a changed profile takes it over and names the fields", () => {
    const { user, events } = logIn(
      registered,
      { ...profile, email: Option.none(), emailVerified: false },
      t1,
    );
    assert.deepStrictEqual(user.email, Option.none());
    assert.isFalse(user.emailVerified);
    assert.isTrue(DateTime.Equivalence(user.updatedAt, t1));
    assert.isTrue(DateTime.Equivalence(user.createdAt, t0));
    assert.strictEqual(user.subject, "kc-1");
    assert.deepStrictEqual(events, [
      new UserProfileChanged({
        userId: id,
        fields: ["email", "emailVerified"],
      }),
    ]);
  });
});
