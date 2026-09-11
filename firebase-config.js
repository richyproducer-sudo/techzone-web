// Configuracion publica de Firebase para la app web de Despachos y Cartera de TechZone.
// Estos valores NO son secretos (es normal que un sitio web tenga esta configuracion
// visible); la seguridad real la dan las reglas de Firestore/Storage (ver firestore.rules
// y storage.rules), que exigen que el usuario haya iniciado sesion.
//
// Para llenarlos: Firebase Console > Configuracion del proyecto (rueda dentada) >
// "Tus apps" > agrega una app web > copia el objeto "firebaseConfig" y pegalo abajo.
window.TECHZONE_FIREBASE_CONFIG = {
  apiKey: 'REEMPLAZA_CON_TU_API_KEY',
  authDomain: 'REEMPLAZA.firebaseapp.com',
  projectId: 'REEMPLAZA',
  storageBucket: 'REEMPLAZA.appspot.com',
  messagingSenderId: 'REEMPLAZA',
  appId: 'REEMPLAZA'
};
