import type { AnyRule } from "../rule-loader.js";

import GEN001 from "./GEN-001-constant-not-cap.js";
import GEN002 from "./GEN-002-duplicated-import.js";
import MAP001 from "./MAP-001-broad-visibility.js";
import MAP002 from "./MAP-002-unused-function.js";
import SOL001 from "./SOL-001-unchecked-call.js";
import SOL002 from "./SOL-002-reentrancy.js";
import SOL003 from "./SOL-003-tx-origin.js";
import SOL005 from "./SOL-005-unchecked-transfer.js";
import SOL006 from "./SOL-006-floating-pragma.js";
import SOL011 from "./SOL-011-div-before-mul.js";
import SOL013 from "./SOL-013-state-update-no-event.js";
import SOL014 from "./SOL-014-double-state-read.js";
import SOL015 from "./SOL-015-no-spdx.js";
import SOL016 from "./SOL-016-no-security-contact.js";
import SOL017 from "./SOL-017-variable-could-be-constant.js";
import SOL018 from "./SOL-018-variable-could-be-immutable.js";
import SOL019 from "./SOL-019-missing-nonce-in-sig.js";
import SOL022 from "./SOL-022-missing-access-control.js";
import SOL023 from "./SOL-023-malformed-modifier.js";
import SOL026 from "./SOL-026-rounding-direction-in-branch.js";
import SOL027 from "./SOL-027-inconsistent-validation.js";
import SOL028 from "./SOL-028-hash-missing-field.js";

export const shippedRules: AnyRule[] = [
    GEN001, GEN002,
    MAP001, MAP002,
    SOL001, SOL002, SOL003, SOL005, SOL006,
    SOL011, SOL013, SOL014, SOL015, SOL016,
    SOL017, SOL018, SOL019, SOL022, SOL023,
    SOL026, SOL027, SOL028,
];
