from pathlib import Path
import json

service_path = Path('services/partnerAntiAbuseService.js')
service = service_path.read_text()
service = service.replace("  const partnerCompany = normalise(partnerUser?.company);\n", '')
service_path.write_text(service)

partner_init_path = Path('public/assets/js/pages/partner-init.js')
partner_init = partner_init_path.read_text()
old_success = """        showStatus(status, '✓ Account created! Redirecting to your dashboard…', 'success');
        setTimeout(() => window.location.replace('/partner/dashboard'), 800);"""
new_success = """        if (data.requiresVerification) {
          showStatus(
            status,
            data.message || 'Account created. Check your email to verify your address before logging in.',
            'success'
          );
          form.reset();
          return;
        }

        showStatus(status, '✓ Account created! You can now log in.', 'success');"""
if old_success in partner_init:
    partner_init = partner_init.replace(old_success, new_success, 1)
elif new_success not in partner_init:
    raise SystemExit('Expected partner signup success block not found')
partner_init_path.write_text(partner_init)

package_path = Path('package.json')
package = json.loads(package_path.read_text())
smoke = package['scripts']['test:smoke']
for test in [
    'tests/unit/partner-anti-abuse-identity.test.js',
    'tests/unit/partner-registration-ui.test.js',
]:
    if test not in smoke:
        smoke += f' {test}'
package['scripts']['test:smoke'] = smoke
package_path.write_text(json.dumps(package, indent=2) + '\n')
