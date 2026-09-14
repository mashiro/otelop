// Atom writers share the app router without importing its route tree (which
// itself reads those atoms when restoring a location).
let navigate: (href: string) => void;

export function configureNavigation(driver: (href: string) => void) {
  navigate = driver;
}

export function navigateLocation(href: string) {
  navigate(href);
}
