from pathlib import Path
import json

service_path = Path('services/partnerAntiAbuseService.js')
service = service_path.read_text()
service = service.replace("  const partnerCompany = normalise(partnerUser?.company);\n", '')
service_path.write_text(service)

package_path = Path('package.json')
package = json.loads(package_path.read_text())
smoke = package['scripts']['test:smoke']
identity_test = 'tests/unit/partner-anti-abuse-identity.test.js'
if identity_test not in smoke:
    smoke += f' {identity_test}'
package['scripts']['test:smoke'] = smoke
package_path.write_text(json.dumps(package, indent=2) + '\n')
