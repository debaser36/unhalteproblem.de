export { Api } from "./Api.ts";

export {
  Authentication,
  CurrentUser,
  SessionCookie,
  SessionSecurity,
} from "./Authentication.ts";
export {
  type Authorization,
  Authorized,
  RequireRoles,
} from "./Authorization.ts";
export { SameOrigin } from "./SameOrigin.ts";

export { AdminGroup, RequireAdmin, RequireSuperAdmin } from "#groups/Admin";
export { AuthGroup } from "#groups/Auth";
export { ContactGroup } from "#groups/Contact";
export { SystemGroup } from "#groups/System";

export {
  AdminUser,
  AdminUserDetails,
  LiftRestrictionPayload,
  RestrictPayload,
  Restriction,
  RestrictionNote,
  RestrictionNoteMaxLength,
  RoleChange,
  UserId,
  UserPage,
  UserPageLimits,
  UserPageQuery,
} from "#domain/Admin";
export {
  LoginErrorParam,
  LoginErrorReason,
  LoginQuery,
  ReturnPath,
  ReturnPathMaxLength,
  Role,
  SessionInfo,
  User,
} from "#domain/Auth";
export {
  ContactEmail,
  ContactMessage,
  ContactMessageBody,
  ContactMessageLimits,
  ContactName,
} from "#domain/ContactMessage";
export { HealthStatus, ReadyStatus } from "#domain/Health";

export { AlreadyRestricted } from "#errors/AlreadyRestricted";
export { Forbidden } from "#errors/Forbidden";
export { NotRestricted } from "#errors/NotRestricted";
export { RateLimited } from "#errors/RateLimited";
export { RestrictionNotAllowed } from "#errors/RestrictionNotAllowed";
export { RoleChangeNotAllowed } from "#errors/RoleChangeNotAllowed";
export { ServiceUnavailable } from "#errors/ServiceUnavailable";
export { Unauthorized } from "#errors/Unauthorized";
export { UserNotFound } from "#errors/UserNotFound";
