// Une lecture facultative ne doit pas bloquer l'interface si le navigateur
// refuse le stockage ou le ferme pendant la destruction du document.
export function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readSessionStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSessionStorage(key: string, value: string): boolean {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// Les écritures sont facultatives pour l'interface. Le booléen permet aux
// appelants qui affichent un état persistant de ne le confirmer qu'après une
// écriture réellement réussie (stockage interdit, quota saturé, etc.).
export function writeLocalStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeLocalStorage(key: string): boolean {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
