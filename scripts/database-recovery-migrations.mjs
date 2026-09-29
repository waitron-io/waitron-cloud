import {migrationNames} from '../packages/registration/src/migrate.ts';

export function hasReleaseMigrationCount(count,manifest=migrationNames){
 return Number(count)===manifest.length;
}
