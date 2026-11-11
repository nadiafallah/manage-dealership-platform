import type {MetadataRoute} from 'next';

export default function manifest():MetadataRoute.Manifest {
 return {
  id:'/',name:'Manage by HEDAX',short_name:'Manage',
  description:'مدیریت عملیات نمایندگی و کارتابل تعمیرات',
  lang:'fa',dir:'rtl',start_url:'/launch',scope:'/',display:'standalone',
  background_color:'#f3f1ec',theme_color:'#f3f1ec',
  icons:[
   {src:'/brand/pwa-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
   {src:'/brand/pwa-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
   {src:'/brand/pwa-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
  ],
 };
}
