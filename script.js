
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// 1. CONFIGURATION FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyCyd0qmQfbhmLlzInWTJCvzaU_aRy7yabQ",
  authDomain: "prono-club-ci-11e65.firebaseapp.com",
  projectId: "prono-club-ci-11e65",
  storageBucket: "prono-club-ci-11e65.firebasestorage.app",
  messagingSenderId: "730031687922",
  appId: "1:730031687922:web:bbf71b0612eefb4b7ca86b",
  measurementId: "G-J1LPHSCK93"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 2. ÉTAT DU SITE
let currentUser = null;
let isAdmin = false;
let coupons = [];
let authMode = "register";
let editingId = null;
let activeStatus = "pending";
let stopCouponsListener = null;
let stopPublicStatsListener = null;
let publicUsers = [];
let stopUsersListener = null;
let toastTimer = null;
let currentProfile = null;

const $ = id => document.getElementById(id);

// 3. OUTILS
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

function setButtonLoading(button, loading, text) {
  button.disabled = loading;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = text || "Patiente...";
  } else {
    button.textContent =
      button.dataset.originalText || text || "Valider";
  }
}

function readableError(error) {
  const errors = {
    "auth/email-already-in-use":
      "Cette adresse e-mail possède déjà un compte.",
    "auth/invalid-email":
      "L'adresse e-mail n'est pas valide.",
    "auth/weak-password":
      "Choisis un mot de passe plus solide.",
    "auth/invalid-credential":
      "E-mail ou mot de passe incorrect.",
    "auth/user-not-found":
      "Aucun compte trouvé avec cet e-mail.",
    "auth/wrong-password":
      "Mot de passe incorrect.",
    "auth/too-many-requests":
      "Trop de tentatives. Réessaie plus tard.",
    "auth/network-request-failed":
      "Connexion Internet indisponible.",
    "permission-denied":
      "Accès refusé. Vérifie les règles Firebase."
  };

  return errors[error.code] ||
    "Une erreur est survenue. Vérifie ta connexion et réessaie.";
}

// 4. STATUTS DES COUPONS
const statusInfo = {
  pending: {
    label: "En attente",
    icon: "⏳",
    className: "status-pending"
  },
  won: {
    label: "Gagné",
    icon: "✅",
    className: "status-won"
  },
  lost: {
    label: "Perdu",
    icon: "❌",
    className: "status-lost"
  }
};

function getCouponStatus(coupon) {
  const status = coupon.status || "pending";
  return statusInfo[status] ? status : "pending";
}

function updateStatusTabs() {
  const filter = $("filterBookmaker").value;

  const filteredCoupons = coupons.filter(coupon =>
    filter === "all" || coupon.bookmaker === filter
  );

  const counts = {
    pending: 0,
    won: 0,
    lost: 0
  };

  filteredCoupons.forEach(coupon => {
    counts[getCouponStatus(coupon)]++;
  });

  $("countPending").textContent = counts.pending;
  $("countWon").textContent = counts.won;
  $("countLost").textContent = counts.lost;

  document.querySelectorAll(".result-tab").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.status === activeStatus
    );
  });
}

// 5. MODALE DE CONNEXION
function openModal(mode = "register") {
  authMode = mode;
  updateAuthModal();
  $("authError").textContent = "";
  $("authModal").classList.remove("hidden");
  $("navLinks").classList.remove("open");
}

function closeModal() {
  $("authModal").classList.add("hidden");
  $("authError").textContent = "";
  $("authForm").reset();
}

function updateAuthModal() {
  const register = authMode === "register";

  $("authTitle").textContent = register
    ? "Créer ton compte"
    : "Bon retour !";

  $("authSubtitle").textContent = register
    ? "Rejoins Prono Club CI."
    : "Connecte-toi à ton espace membre.";

  $("nameGroup").classList.toggle("hidden", !register);
  $("fullName").required = register;

  $("bookmakerGroup").classList.toggle("hidden", !register);
  $("userBookmaker").required = register;

  $("authSubmit").textContent = register
    ? "Créer mon compte"
    : "Se connecter";

  $("switchAuth").textContent = register
    ? "Déjà inscrit ? Se connecter"
    : "Pas encore de compte ? S'inscrire";
}

// 6. INTERFACE SELON LA CONNEXION
function renderAuthState() {
  const connected = Boolean(currentUser);

  $("loginTop").classList.toggle("hidden", connected);
  $("registerTop").classList.toggle("hidden", connected);
  $("logoutBtn").classList.toggle("hidden", !connected);

  $("heroActions").classList.toggle("hidden", connected);
  $("welcomeUser").classList.toggle("hidden", !connected);
  $("lockedPanel").classList.toggle("hidden", connected);
  $("memberPanel").classList.toggle("hidden", !connected);
  $("adminPanel").classList.toggle("hidden", !connected || !isAdmin);

  if (connected) {
    const name = currentUser.displayName ||
      currentUser.email.split("@")[0];

    $("welcomeUser").textContent = "Connecté : " + name;
    $("memberGreeting").textContent =
      "Bienvenue dans ton espace, " + name + " !";

    $("couponSubtitle").textContent =
      "Retrouve les publications disponibles.";
  } else {
    $("couponSubtitle").textContent =
      "Connecte-toi pour consulter les publications.";
  }
}

// 7. INSCRIPTION ET CONNEXION
$("authForm").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("authSubmit");
  const email = $("email").value.trim();
  const password = $("password").value;
  const name = $("fullName").value.trim();
  const userBookmaker = $("userBookmaker").value;

  $("authError").textContent = "";
  setButtonLoading(button, true, "Patiente...");

  try {
    if (authMode === "register") {
      if (name.length < 2) {
        throw new Error("Entre un nom d'au moins 2 caractères.");
      }

      if (!["1xBet", "Betclic", "Les deux"].includes(userBookmaker)) {
        throw new Error("Choisis ton bookmaker pour continuer.");
      }

      const result = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      await updateProfile(result.user, {
        displayName: name
      });

      await setDoc(doc(db, "users", result.user.uid), {
        uid: result.user.uid,
        name: name,
        email: email,
        bookmaker: userBookmaker,
        role: "member",
        createdAt: serverTimestamp()
      });

      closeModal();
      showToast("Compte créé avec succès !");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      closeModal();
      showToast("Connexion réussie !");
    }
  } catch (error) {
    $("authError").textContent =
      error.message && !error.code
        ? error.message
        : readableError(error);

    if (error.code === "permission-denied") {
      $("authError").textContent =
        "Le compte peut exister, mais le profil n'a pas été enregistré. Vérifie les règles Firestore.";
    }
  } finally {
    setButtonLoading(button, false);
  }
});

$("switchAuth").addEventListener("click", () => {
  openModal(authMode === "register" ? "login" : "register");
});

$("closeModal").addEventListener("click", closeModal);
$("modalBackdrop").addEventListener("click", closeModal);

$("loginTop").addEventListener("click", () => openModal("login"));
$("registerTop").addEventListener("click", () => openModal("register"));
$("heroLogin").addEventListener("click", () => openModal("login"));
$("heroRegister").addEventListener("click", () => openModal("register"));
$("lockedRegister").addEventListener("click", () => openModal("register"));

$("logoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    showToast("Tu es déconnecté.");
  } catch (error) {
    showToast(readableError(error));
  }
});

$("menuBtn").addEventListener("click", () => {
  $("navLinks").classList.toggle("open");
});

$("navLinks").addEventListener("click", event => {
  if (event.target.closest("a")) {
    $("navLinks").classList.remove("open");
  }
});

// 8. VALIDATION DES IMAGES
function validImageURL(value) {
  if (!value) return "";

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

// 9. PUBLICATION ET MODIFICATION DES COUPONS
$("couponForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser || !isAdmin) {
    showToast("Accès réservé à l'administrateur.");
    return;
  }

  const button = $("publishBtn");
  const title = $("couponTitle").value.trim();
  const bookmaker = $("bookmaker").value;
  const code = $("couponCode").value.trim();
  const imageURL = validImageURL($("couponImage").value.trim());
  const note = $("couponNote").value.trim();

  if (!title) {
    showToast("Entre un titre.");
    return;
  }

  if (imageURL === null) {
    showToast("L'URL de l'image n'est pas valide.");
    return;
  }

  if (!["1xBet", "Betclic"].includes(bookmaker)) {
    showToast("Bookmaker non autorisé.");
    return;
  }

  setButtonLoading(button, true, "Publication...");

  try {
    const data = {
      title,
      bookmaker,
      code,
      imageURL,
      note,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    };

    if (editingId) {
      await updateDoc(doc(db, "coupons", editingId), data);
      showToast("Coupon modifié !");
    } else {
      await addDoc(collection(db, "coupons"), {
        ...data,
        status: "pending",
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid
      });

      activeStatus = "pending";
      showToast("Coupon publié dans En attente !");
    }

    resetCouponForm();
    renderCoupons();
  } catch (error) {
    showToast(readableError(error));
  } finally {
    setButtonLoading(button, false);
  }
});

function resetCouponForm() {
  editingId = null;
  $("editCouponId").value = "";
  $("couponForm").reset();
  $("publishBtn").textContent = "Publier le coupon";
  $("cancelEdit").classList.add("hidden");
}

$("cancelEdit").addEventListener("click", resetCouponForm);

function startEditing(id) {
  if (!isAdmin) return;

  const coupon = coupons.find(item => item.id === id);
  if (!coupon) return;

  editingId = id;
  $("editCouponId").value = id;
  $("couponTitle").value = coupon.title || "";
  $("bookmaker").value = coupon.bookmaker || "1xBet";
  $("couponCode").value = coupon.code || "";
  $("couponImage").value = coupon.imageURL || "";
  $("couponNote").value = coupon.note || "";

  $("publishBtn").textContent = "Enregistrer les modifications";
  $("cancelEdit").classList.remove("hidden");

  $("adminPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

// 10. CHANGEMENT DU RÉSULTAT D'UN COUPON
async function saveCouponStatus(id) {
  if (!currentUser || !isAdmin) {
    showToast("Seul l'administrateur peut modifier les résultats.");
    return;
  }

  const select = $("statusSelect-" + id);
  const button = $("statusSave-" + id);

  if (!select || !button) return;

  const newStatus = select.value;

  if (!["pending", "won", "lost"].includes(newStatus)) {
    showToast("Résultat invalide.");
    return;
  }

  const coupon = coupons.find(item => item.id === id);
  if (!coupon) return;

  if (getCouponStatus(coupon) === newStatus) {
    showToast("Ce coupon possède déjà ce statut.");
    return;
  }

  setButtonLoading(button, true, "Enregistrement...");

  try {
    await updateDoc(doc(db, "coupons", id), {
      status: newStatus,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    });

    showToast("Résultat enregistré : " + statusInfo[newStatus].label);
  } catch (error) {
    showToast(readableError(error));
  } finally {
    if (button.isConnected) {
      setButtonLoading(button, false);
    }
  }
}

// 11. SUPPRESSION DES COUPONS
async function removeCoupon(id) {
  if (!currentUser || !isAdmin) {
    showToast("Accès refusé.");
    return;
  }

  if (!window.confirm("Veux-tu vraiment supprimer cette publication ?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "coupons", id));
    showToast("Publication supprimée.");
  } catch (error) {
    showToast(readableError(error));
  }
}

// 12. AFFICHAGE DES COUPONS
function formatDate(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "Publication récente";
  }

  return timestamp.toDate().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderCoupons() {
  const list = $("couponList");
  const filter = $("filterBookmaker").value;

  updateStatusTabs();

  const visibleCoupons = coupons.filter(coupon => {
    const bookmakerMatches =
      filter === "all" || coupon.bookmaker === filter;

    return bookmakerMatches &&
      getCouponStatus(coupon) === activeStatus;
  });

  if (visibleCoupons.length === 0) {
    const messages = {
      pending: "Aucun coupon en attente pour le moment.",
      won: "Aucun coupon gagné pour le moment.",
      lost: "Aucun coupon perdu pour le moment."
    };

    list.innerHTML =
      `<p class="empty-state">${messages[activeStatus]}</p>`;
    return;
  }

  list.innerHTML = visibleCoupons.map(coupon => {
    const id = escapeHTML(coupon.id);
    const title = escapeHTML(coupon.title || "Coupon sportif");
    const bookmakerValue = coupon.bookmaker || "";
const bookmaker = escapeHTML(bookmakerValue);

const bookmakerClass = bookmakerValue === "Betclic" ?
  "bookmaker-betclic" :
  "bookmaker-1xbet";
    const code = escapeHTML(coupon.code || "");
    const note = escapeHTML(coupon.note || "");
    const date = escapeHTML(formatDate(coupon.createdAt));

    const status = getCouponStatus(coupon);
    const info = statusInfo[status];
    const safeImage = validImageURL(coupon.imageURL || "");

    const imageHTML = safeImage
      ? `<img class="coupon-image"
          src="${escapeHTML(safeImage)}"
          alt="Capture du coupon"
          loading="lazy"
          referrerpolicy="no-referrer">`
      : "";

    const codeHTML = code
      ? `<div class="code-box">
          <span class="code-text">${code}</span>
          <button class="copy-btn"
            data-action="copy" data-id="${id}">Copier</button>
        </div>`
      : "";

    const statusHTML = `
      <div class="coupon-status-row">
        <span class="status-badge ${info.className}">
          ${info.icon} ${info.label}
        </span>
      </div>
    `;

    const adminHTML = isAdmin
      ? `<div class="admin-actions">
          <button class="small-btn"
            data-action="edit" data-id="${id}">Modifier</button>

          <button class="small-btn delete-btn"
            data-action="delete" data-id="${id}">Supprimer</button>

          <div class="status-admin-controls">
            <div class="status-select-wrap">
              <label for="statusSelect-${id}">Modifier le résultat</label>
              <select id="statusSelect-${id}">
                <option value="pending" ${status === "pending" ? "selected" : ""}>⏳ En attente</option>
                <option value="won" ${status === "won" ? "selected" : ""}>✅ Gagné</option>
                <option value="lost" ${status === "lost" ? "selected" : ""}>❌ Perdu</option>
              </select>
            </div>

            <button class="status-save-btn"
              id="statusSave-${id}"
              data-action="save-status"
              data-id="${id}">
              Enregistrer le résultat
            </button>
          </div>
        </div>`
      : "";

    return `
      <article class="coupon-card">
        <div class="coupon-card-body">
          <div class="coupon-card-top">
            <span class="bookmaker-badge">${bookmaker}</span>
            <span class="coupon-date">${date}</span>
          </div>

          ${statusHTML}
          <h4>${title}</h4>
          ${note ? `<p class="coupon-note">${note}</p>` : ""}
          ${imageHTML}
          ${codeHTML}
        </div>
        ${adminHTML}
      </article>
    `;
  }).join("");
}

// 13. ONGLETS DES RÉSULTATS
document.querySelectorAll(".result-tab").forEach(button => {
  button.addEventListener("click", () => {
    const status = button.dataset.status;

    if (!["pending", "won", "lost"].includes(status)) return;

    activeStatus = status;
    renderCoupons();
  });
});

// 14. ACTIONS SUR LES COUPONS
$("couponList").addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (action === "edit") startEditing(id);
  if (action === "delete") await removeCoupon(id);
  if (action === "save-status") await saveCouponStatus(id);

  if (action === "copy") {
    const coupon = coupons.find(item => item.id === id);
    if (!coupon || !coupon.code) return;

    try {
      await navigator.clipboard.writeText(coupon.code);
      showToast("Code copié !");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = coupon.code;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();

      const copied = document.execCommand("copy");
      textarea.remove();

      showToast(copied ? "Code copié !" : "Copie le code manuellement.");
    }
  }
});

// 15. FILTRE BOOKMAKER
$("filterBookmaker").addEventListener("change", renderCoupons);

// 16. SUIVI DU COMPTE ET DES PUBLICATIONS FIREBASE
onAuthStateChanged(auth, async user => {
  currentUser = user;
  isAdmin = false;
  currentProfile = null;
  coupons = [];

  if (stopCouponsListener) {
    stopCouponsListener();
    stopCouponsListener = null;
  }

  if (stopUsersListener) {
    stopUsersListener();
    stopUsersListener = null;
  }

  renderAuthState();
  renderCoupons();

  if (!user) return;

  try {
    const profileRef = doc(db, "users", user.uid);
    let profileSnap = await getDoc(profileRef);

    if (!profileSnap.exists()) {
      await setDoc(profileRef, {
        uid: user.uid,
        name: user.displayName || "",
        email: user.email || "",
        role: "member",
        createdAt: serverTimestamp()
      });

      profileSnap = await getDoc(profileRef);
    }

    if (!profileSnap.exists()) {
      throw new Error("Le profil utilisateur n'a pas été créé.");
    }

    currentProfile = profileSnap.data();
    isAdmin = currentProfile.role === "admin";

    renderAuthState();

    const couponsQuery = query(
      collection(db, "coupons"),
      orderBy("createdAt", "desc")
    );
    if (isAdmin) {
  stopUsersListener = onSnapshot(
    collection(db, "users"),
    snapshot => {
      publicUsers = snapshot.docs.map(item => item.data());
      refreshPublicStats();
    },
    error => {
      console.error("Erreur membres :", error);
    }
  );
}

    stopCouponsListener = onSnapshot(
    couponsQuery,
    snapshot => {
      coupons = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));
      
      renderCoupons();
      refreshPublicStats();
      },
      error => {
        console.error("Erreur coupons :", error);
        $("couponList").innerHTML =
          '<p class="empty-state">Impossible de charger les coupons. Vérifie les règles Firestore.</p>';
      }
    );

  } catch (error) {
    console.error("Erreur profil :", error);
    isAdmin = false;
    renderAuthState();
    showToast(readableError(error));
  }
});
// STATISTIQUES PUBLIQUES

function renderPublicStats(data = {}) {
  $("statTotal").textContent = data.totalCoupons || 0;
  $("statWon").textContent = data.won || 0;
  $("statLost").textContent = data.lost || 0;
  $("statPending").textContent = data.pending || 0;
  $("statRate").textContent = (data.rate || 0) + " %";
  
  $("stat1xBet").textContent = data.oneXBet || 0;
  $("statBetclic").textContent = data.betclic || 0;
  $("statBoth").textContent = data.both || 0;
  $("statMembers").textContent = data.totalMembers || 0;
    $("oneXWon").textContent = data.oneXWon || 0;
  $("oneXLost").textContent = data.oneXLost || 0;
  $("oneXPending").textContent = data.oneXPending || 0;
  $("oneXRate").textContent = (data.oneXRate || 0) + " %";

  $("betclicWon").textContent = data.betclicWon || 0;
  $("betclicLost").textContent = data.betclicLost || 0;
  $("betclicPending").textContent = data.betclicPending || 0;
  $("betclicRate").textContent = (data.betclicRate || 0) + " %";
}


async function refreshPublicStats() {
  if (!isAdmin) return;

  const counts = {
    totalCoupons: coupons.length,
    won: 0,
    lost: 0,
    pending: 0,
    oneXBet: 0,
    betclic: 0,
    both: 0,
    totalMembers: publicUsers.length,

    oneXWon: 0,
    oneXLost: 0,
    oneXPending: 0,

    betclicWon: 0,
    betclicLost: 0,
    betclicPending: 0
  };

  coupons.forEach(coupon => {
    const status = getCouponStatus(coupon);

    if (counts[status] !== undefined) {
      counts[status]++;
    }

    if (coupon.bookmaker === "1xBet") {
      counts["oneX" + status.charAt(0).toUpperCase() + status.slice(1)]++;
    }

    if (coupon.bookmaker === "Betclic") {
      counts["betclic" + status.charAt(0).toUpperCase() + status.slice(1)]++;
    }
  });

  publicUsers.forEach(user => {
    if (user.bookmaker === "1xBet") counts.oneXBet++;
    if (user.bookmaker === "Betclic") counts.betclic++;
    if (user.bookmaker === "Les deux") counts.both++;
  });

  const finished = counts.won + counts.lost;

  counts.rate = finished > 0
    ? Math.round((counts.won / finished) * 100)
    : 0;

  const oneXFinished = counts.oneXWon + counts.oneXLost;

  counts.oneXRate = oneXFinished > 0
    ? Math.round((counts.oneXWon / oneXFinished) * 100)
    : 0;

  const betclicFinished = counts.betclicWon + counts.betclicLost;

  counts.betclicRate = betclicFinished > 0
    ? Math.round((counts.betclicWon / betclicFinished) * 100)
    : 0;

  try {
    await setDoc(doc(db, "publicStats", "main"), {
      ...counts,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Erreur statistiques :", error);
  }
}


// Lecture publique des statistiques
stopPublicStatsListener = onSnapshot(
  doc(db, "publicStats", "main"),
  snapshot => {
    renderPublicStats(
      snapshot.exists() ? snapshot.data() : {}
    );
  },
  error => {
    console.error("Lecture statistiques :", error);
  }
);
// 17. ANNÉE AUTOMATIQUE
$("year").textContent = new Date().getFullYear();
