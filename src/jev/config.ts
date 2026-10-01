export const JEV_DECISION_HZ = 2;
export const SIGHT_RANGE = 65;
export const SIGHT_HALF_ANGLE = Math.PI * 0.65;
export const MEMORY_TICKS = 180;
export const PLAN_TICKS = 30;
export const SAFETY_MARGIN = 0.8;
export const LOOKAHEAD_SECONDS = 0.65;
// Short clear local paths need incremental steering rather than a full acceleration/coast overrun.
export const SHORT_PATH_PREDICTION_TICKS = 8;

export const BODY_SPACING = 6.5;
// Deadzone must exceed half one motor turn step to avoid overshoot alternation.
export const TURN_DEADZONE_EPSILON = 0.005;

export const EXPIRED_AIM_GRACE_TICKS = 6;
export const HOLD_ALLY_FRESH_TICKS = 15;

export const SPACING_RELEASE_DISTANCE = 9;
export const SPACING_RECOVERY_MAX_TICKS = 120;

export const SQUAD_REVIEW_TICKS = 120;
export const SQUAD_CONTACT_HYSTERESIS_TICKS = 45;
export const SQUAD_HUNT_MAX_TICKS = 450;
export const MISSION_STEP_DISTANCE = 18;
export const MOTION_WINDOW_TICKS = 60;
export const MOTION_STALL_TICKS = 30;
