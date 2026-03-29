import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Issue #374 – Fine-grained permission scopes.
 *
 * New scopes:
 *   inventory:write       – create/update/delete inventory records
 *   dispatch:override     – force-assign or override dispatch decisions
 *   request:approve       – approve / reject blood-request workflows
 *   dispute:resolve       – manage and resolve disputes
 *   verification:admin    – verify / unverify healthcare actors
 *   settlement:release    – release escrowed settlement funds
 */
export class AddFineGrainedPermissionScopes1820000002000
  implements MigrationInterface
{
  private readonly NEW_SCOPES = [
    'inventory:write',
    'dispatch:override',
    'request:approve',
    'dispute:resolve',
    'verification:admin',
    'settlement:release',
  ];

  /** Roles that receive each new scope */
  private readonly ROLE_SCOPE_MAP: Record<string, string[]> = {
    admin: [
      'inventory:write',
      'dispatch:override',
      'request:approve',
      'dispute:resolve',
      'verification:admin',
      'settlement:release',
    ],
    vendor: ['inventory:write'],
    hospital: ['request:approve'],
    rider: ['dispatch:override'],
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [role, scopes] of Object.entries(this.ROLE_SCOPE_MAP)) {
      for (const scope of scopes) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission)
           SELECT id, $1 FROM roles WHERE name = $2
           ON CONFLICT DO NOTHING`,
          [scope, role],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const scope of this.NEW_SCOPES) {
      await queryRunner.query(
        `DELETE FROM role_permissions WHERE permission = $1`,
        [scope],
      );
    }
  }
}
