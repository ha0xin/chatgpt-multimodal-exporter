import type { MonkeyWindow } from 'vite-plugin-monkey/dist/client';

export interface ClientBootstrap {
  authStatus: "logged_in" | "logged_out" | string; // 比如 "logged_in"
  session: ClientSession;
  user: BootstrapUser;
  cluster: string;
  locale: string;
  secFetchSite: string;
  statsigPayload?: StatsigPayload;
  isNoAuthEnabled: boolean;
  userRegion: string;
  userCountry: string;
  userContinent: string;
  cfConnectingIp: string;
  cfIpLatitude: string;
  cfIpLongitude: string;
  cfIpCity: string;
  isUserInPioneerHR: boolean;
  eligibleMarketing: EligibleFlags;
  eligibleNoCookieBusinessMarketing: EligibleFlags;
  eligibleNoCookieConsumerMarketing: EligibleFlags;
  isElectron: boolean;
  isBusinessIp2: boolean;
  isIos: boolean;
  isAndroidChrome: boolean;
  promoteCss: boolean;
  isContainerOTR: boolean;
  cspScriptNonce: string;
}

export interface ClientSession {
  user: BootstrapUser;
  expires: string; // ISO datetime
  account?: AccountInfo; // 只有用户选择了个人还是team之后才存在
  accessToken: string;
  authProvider: string; // e.g. "openai"
  rumViewTags: {
    light_account: {
      fetched: boolean;
    };
    // 这里如果后面有更多 tag，可以继续加
    [key: string]: unknown;
  };
}

export interface BootstrapUser {
  id: string;
  email: string;
  idp: string; // 身份提供方，比如 "auth0"
  iat: number; // issued-at timestamp (秒)
  mfa: boolean;
}

export interface AccountInfo {
  id: string;
  planType: 'team' | 'free' | string; // "team" 等
  structure: "personal" | "workspace" | string; // "workspace" 等
  workspaceType: string | null;
  organizationId: string;
  isDelinquent: boolean;
  gracePeriodId: string | null;
}

export interface EligibleFlags {
  isUserEligibleForPioneer: boolean;
  isUserEligibleForMaverick: boolean;
  isUserEligibleForTrailBlazer: boolean;
  isUserEligibleForStratos: boolean;
  isUserEligibleForSeeker: boolean;
  isUserEligibleForWayfinder: boolean;
}

// ---- Statsig 相关类型（略微宽松，避免后端结构改动就编译爆炸） ----

export interface StatsigPayload {
  feature_gates: Record<string, unknown>;
  dynamic_configs: Record<string, unknown>;
  layer_configs: Record<string, unknown>;
  sdkParams: Record<string, unknown>;
  has_updates: boolean;
  generator: string;
  sdkInfo: {
    sdkType: string;
    sdkVersion: string;
  };
  time: number;
  evaluated_keys: {
    userID: string;
    customIDs: StatsigCustomIDs;
  };
  hash_used: string;
  user: StatsigUser;
  recording_blocked: boolean;
  can_record_session: boolean;
  session_recording_rate: number;
}

export interface StatsigCustomIDs {
  WebAnonymousCookieID: string;
  DeviceId: string;
  stableID: string;
  workspace_id: string;
  account_id: string;
  org_id: string;
  [key: string]: string;
}

export interface StatsigUser {
  userID: string;
  email: string;
  ip: string;
  country: string;
  userAgent: string;
  custom: {
    plan_type: string;
    workspace_id: string;
    account_id: string;
    org_id: string;
    client_type: string;
    is_paid: boolean;
    auth_status: string; // "logged_in" 等
    has_logged_in_before: boolean;
    user_agent: string;
    is_punch_out_user: boolean;
    email_domain_type: string;
    is_delinquent: boolean;
    grace_period_id: string | null;
    is_business_ip2: boolean;
    region: string;
    region_code: string;
    state: string;
    [key: string]: unknown;
  };
  locale: string;
  customIDs: StatsigCustomIDs;
  statsigEnvironment: {
    tier: string; // "production" 等
    [key: string]: unknown;
  };
}

declare global {
  // 1. 扩展 Window，这样 `Window & typeof globalThis` 里就有这个字段了
  interface Window {
    CLIENT_BOOTSTRAP: ClientBootstrap;
  }

  // 2. 顺便也扩一份 MonkeyWindow，万一你哪天用 monkeyWindow 也能享受类型
  interface MonkeyWindow {
    CLIENT_BOOTSTRAP: ClientBootstrap;
  }
}

// 让这个 d.ts 被视为一个模块，避免与其他声明冲突
export { };
