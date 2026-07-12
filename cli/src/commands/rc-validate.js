import { defineScriptCommand } from "../core/shell.js";

export function registerRcValidateCommand(program) {
    defineScriptCommand(program, {
        name: "rc-validate",
        description: "Distribution Verification & RC Validation - GitHub Release/npm/Homebrew/install/smoke tests + docs/RCValidationReport.md (see RELEASE.md)",
        script: "scripts/rc-validate.sh"
    });
}
