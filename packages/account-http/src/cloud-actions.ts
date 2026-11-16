import type {Context} from 'hono';
import type {CloudActions} from '@waitron-cloud/registration';
import {AccountHttpError} from './errors.ts';
import {readSessionCookie} from './cookies.ts';

export async function cloudActionsResponse(c:Context,actions:CloudActions,secure:boolean){
 if(c.req.path!=='/api/account/operator/actions')throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='GET')throw new AccountHttpError(405,'method_not_allowed');
 return c.json(await actions.read(readSessionCookie(c,secure)??''));
}
