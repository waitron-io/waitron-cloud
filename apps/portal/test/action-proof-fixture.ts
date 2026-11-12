import type {Route} from 'playwright';
// These screen tests start after proof; the owning proof journey tests verification itself.
export function mockActionProof(route:Route,enrolled=false){
 if(new URL(route.request().url()).pathname==='/api/account/action-proof')return route.fulfill({json:{methods:enrolled?['passkey','recovery']:['email'],freshUntil:'2099-01-01T00:00:00.000Z'}});
 return undefined;
}
