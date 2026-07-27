export { getXrSystem, isImmersiveVrSupported } from '@/xr/XrSupport.js';
export type { XrSessionMode } from '@/xr/XrSupport.js';
export { XrSessionManager } from '@/xr/XrSessionManager.js';
export type { XrSessionPhase } from '@/xr/XrSessionManager.js';
export {
  XR_ANCHOR_IDS,
  cameraStateForAnchor,
  nextAnchorId,
  type XrAnchorId,
} from '@/xr/XrAnchors.js';
export { viewDescriptorForXrEye, composeViewEci } from '@/xr/XrPoseBridge.js';
