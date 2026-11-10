const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const crypto=require('node:crypto');
initializeApp();
const managers=new Set(['nikkhaikal@gmail.com','nealia.najihah@gmail.com']);

exports.createAccount=onCall(async request=>{
  const caller=request.auth?.token?.email?.toLowerCase();
  if(!caller)throw new HttpsError('unauthenticated','Sign in to add an HP account.');
  const isManager=managers.has(caller),firestore=getFirestore();
  if(!isManager){const profile=await firestore.doc(`users/${request.auth.uid}`).get();const parentCode=profile.data()?.hpCode;if(!parentCode)throw new HttpsError('permission-denied','Your account is not linked to an HP.');const parent=await firestore.doc(`hps/${parentCode}`).get();if(!parent.exists||parent.data().uid!==request.auth.uid)throw new HttpsError('permission-denied','Your HP account could not be verified.');}
  const {code:rawCode,name:rawName,email:rawEmail}=request.data||{};
  const code=String(rawCode||'').trim().toUpperCase(),name=String(rawName||'').trim(),email=String(rawEmail||'').trim().toLowerCase();
  if(!/^[A-Z0-9-]{2,24}$/.test(code)||!name||name.length>100||!/^\S+@\S+\.\S+$/.test(email))throw new HttpsError('invalid-argument','Enter a unique HP code (letters, numbers or hyphens), name and email.');
  const hpRef=firestore.doc(`hps/${code}`);
  if((await hpRef.get()).exists)throw new HttpsError('already-exists','This HP code already exists.');
  let account,created=false,temporaryPassword;
  try{account=await getAuth().getUserByEmail(email)}catch(error){if(error.code!=='auth/user-not-found')throw error}
  if(account){if(!isManager)throw new HttpsError('already-exists','This email already has an account. Ask Jiha or the admin to link it.');const profile=await firestore.doc(`users/${account.uid}`).get();if(profile.exists&&profile.data().hpCode)throw new HttpsError('already-exists','This account already has an HP code.');}
  if(!account){temporaryPassword=crypto.randomBytes(18).toString('base64url');account=await getAuth().createUser({displayName:name,email,password:temporaryPassword});created=true}
  try{
    await hpRef.create({name,email,uid:account.uid,parentUid:isManager?null:request.auth.uid,createdBy:caller,createdAt:new Date().toISOString()});
    await firestore.doc(`users/${account.uid}`).set({name,email,role:'member',hpCode:code,createdBy:caller},{merge:true});
  }catch(error){if(created)await getAuth().deleteUser(account.uid).catch(()=>{});if(error.code===6)throw new HttpsError('already-exists','This HP code already exists.');throw error}
  return {code,email,temporaryPassword:temporaryPassword||null,existingAccount:!created};
});
