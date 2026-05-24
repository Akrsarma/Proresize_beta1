(function() {
  'use strict';

  var SDK_VERSION = '12.7.0';
  var SDK_BASE = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION;
  var HISTORY_LIMIT = 25;
  var LOCAL_HISTORY_KEY = 'proresize-local-history';
  var HISTORY_PENDING_SYNC_KEY = 'proresize-history-pending-sync';
  var firebaseReady = false;
  var auth = null;
  var db = null;
  var rtdb = null;
  var googleProvider = null;
  var authApi = null;
  var firestoreApi = null;
  var databaseApi = null;
  var stateReady = null;
  var loginPromptClosedForSession = false;

  function formatDate(value) {
    if (!value) return 'Just now';
    try {
      if (typeof value.toDate === 'function') {
        return value.toDate().toLocaleString();
      }
      return new Date(value).toLocaleString();
    } catch (err) {
      return 'Just now';
    }
  }

  function createHistoryEntry(entry) {
    var clientHistoryId = entry.clientHistoryId || ('h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
    return {
      tool: entry.tool || 'Action',
      summary: entry.summary || '',
      inputName: entry.inputName || 'image',
      inputSize: entry.inputSize || '',
      outputSize: entry.outputSize || '',
      dimensions: entry.dimensions || '',
      format: entry.format || '',
      mode: entry.mode || '',
      changeSummary: entry.changeSummary || '',
      clientHistoryId: clientHistoryId,
      createdAt: entry.createdAt || Date.now()
    };
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showRuntimeMessage(message) {
    var historyList = document.getElementById('historyList');
    var authStatus = document.getElementById('authStatus');

    if (authStatus) {
      authStatus.className = 'auth-status error';
      authStatus.style.display = 'block';
      authStatus.textContent = message;
    }

    if (historyList) {
      historyList.innerHTML = '<div class="history-empty">' + escapeHtml(message) + '</div>';
    }
  }

  function getAuthErrorMessage(err, fallback) {
    var code = err && err.code ? String(err.code) : '';
    if (code === 'auth/email-not-verified') {
      return 'Please verify your email before logging in. We sent you a verification link. Check your inbox and spam folder.';
    }
    if (code === 'auth/email-already-in-use') {
      return (err && err.message) || 'This email already has an account. Please log in instead.';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return 'Incorrect email or password. Please try again.';
    }
    if (code === 'auth/invalid-email') {
      return 'Please enter a valid email address.';
    }
    if (code === 'auth/weak-password') {
      return 'Your password is too weak. Please use at least 6 characters.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Too many attempts were made. Please wait a little and try again.';
    }
    return (err && err.message) || fallback;
  }

  async function getSignInMethodsForEmail(email) {
    if (!firebaseReady || !auth || !email) return [];
    try {
      return await authApi.fetchSignInMethodsForEmail(auth, email);
    } catch (err) {
      console.warn('Could not fetch sign-in methods for email.', err);
      return [];
    }
  }

  function buildEmailInUseError(email, methods) {
    var normalizedMethods = Array.isArray(methods) ? methods : [];
    var error = new Error('This email already has an account. Please log in instead.');
    error.code = 'auth/email-already-in-use';

    if (normalizedMethods.indexOf('google.com') !== -1 && normalizedMethods.indexOf('password') === -1) {
      error.message = 'This email is already linked to Google sign-in. Please use Continue with Google.';
      return error;
    }

    if (normalizedMethods.indexOf('password') !== -1) {
      error.message = 'This email is already registered with password login. Please log in or use Forgot password.';
      return error;
    }

    if (normalizedMethods.length) {
      error.message = 'This email is already linked to an existing account. Please log in with the original sign-in method.';
      return error;
    }

    if (email) {
      error.message = 'This email may already exist in Firebase. Please try logging in or use Forgot password.';
    }

    return error;
  }

  function loadLocalHistory() {
    try {
      var raw = localStorage.getItem(LOCAL_HISTORY_KEY);
      var items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(items)) return [];
      return items.sort(function(a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      }).slice(0, HISTORY_LIMIT);
    } catch (err) {
      console.warn('Could not read local history.', err);
      return [];
    }
  }

  async function prepareHistoryEntry(entry) {
    return createHistoryEntry(entry || {});
  }

  async function saveLocalHistoryItem(entry) {
    try {
      var items = loadLocalHistory();
      items.unshift(createHistoryEntry(entry));
      items = items.slice(0, HISTORY_LIMIT);
      localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(items));
      return true;
    } catch (err) {
      console.warn('Could not save local history.', err);
      return false;
    }
  }

  function clearLocalHistory() {
    try {
      localStorage.removeItem(LOCAL_HISTORY_KEY);
      return true;
    } catch (err) {
      console.warn('Could not clear local history.', err);
      return false;
    }
  }

  function loadPendingHistoryQueue() {
    try {
      var raw = localStorage.getItem(HISTORY_PENDING_SYNC_KEY);
      var queue = raw ? JSON.parse(raw) : [];
      return Array.isArray(queue) ? queue : [];
    } catch (err) {
      console.warn('Could not read pending history queue.', err);
      return [];
    }
  }

  function savePendingHistoryQueue(queue) {
    try {
      localStorage.setItem(HISTORY_PENDING_SYNC_KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
      return true;
    } catch (err) {
      console.warn('Could not save pending history queue.', err);
      return false;
    }
  }

  function enqueuePendingHistoryItem(userId, entry) {
    var queue = loadPendingHistoryQueue();
    var pendingId = 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    queue.push({
      id: pendingId,
      userId: userId,
      entry: createHistoryEntry(entry),
      queuedAt: Date.now()
    });
    savePendingHistoryQueue(queue);
    return pendingId;
  }

  function removePendingHistoryItem(pendingId) {
    if (!pendingId) return false;
    var queue = loadPendingHistoryQueue();
    var next = queue.filter(function(item) {
      return item && item.id !== pendingId;
    });
    return savePendingHistoryQueue(next);
  }

  function getPendingHistoryForUser(userId) {
    return loadPendingHistoryQueue().filter(function(item) {
      return item && item.userId === userId && item.entry;
    });
  }

  function removePendingHistoryForUser(userId) {
    if (!userId) return false;
    var queue = loadPendingHistoryQueue();
    var next = queue.filter(function(item) {
      return !item || item.userId !== userId;
    });
    return savePendingHistoryQueue(next);
  }

  function getHistoryTimestampValue(value) {
    if (!value) return 0;
    try {
      if (typeof value.toDate === 'function') {
        return value.toDate().getTime();
      }
      var parsed = new Date(value).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    } catch (err) {
      return 0;
    }
  }

  function mergeHistoryItemsForDisplay() {
    var all = [];
    for (var i = 0; i < arguments.length; i += 1) {
      if (Array.isArray(arguments[i])) {
        all = all.concat(arguments[i]);
      }
    }

    var seen = {};
    var unique = [];
    all.forEach(function(item) {
      if (!item) return;
      var ts = Math.floor(getHistoryTimestampValue(item.createdAt) / 1000);
      var dedupeKey = [
        item.clientHistoryId || '',
        item.tool || '',
        item.summary || '',
        item.inputName || '',
        item.outputSize || '',
        item.dimensions || '',
        item.format || '',
        ts
      ].join('|');

      if (seen[dedupeKey]) {
        var existing = seen[dedupeKey];
        if (!existing.changeSummary && item.changeSummary) existing.changeSummary = item.changeSummary;
        if (!existing.clientHistoryId && item.clientHistoryId) existing.clientHistoryId = item.clientHistoryId;
        return;
      }
      seen[dedupeKey] = item;
      unique.push(item);
    });

    unique.sort(function(a, b) {
      return getHistoryTimestampValue(b.createdAt) - getHistoryTimestampValue(a.createdAt);
    });
    return unique.slice(0, HISTORY_LIMIT);
  }

  function getConfig() {
    var config = window.PRORESIZE_FIREBASE_CONFIG || null;
    if (!config || !config.apiKey || config.apiKey === 'PASTE_YOUR_API_KEY') return null;
    return config;
  }

  function useRealtimeDatabase() {
    var config = getConfig();
    return !!(config && config.databaseURL && databaseApi && rtdb);
  }

  function useFirestoreDatabase() {
    return !!(firestoreApi && db);
  }

  function getHistoryBackendLabel() {
    if (useRealtimeDatabase()) return 'Firebase Realtime Database';
    if (useFirestoreDatabase()) return 'Cloud Firestore';
    return 'Firebase';
  }

  function getHistoryLoadMessage() {
    if (useRealtimeDatabase() && useFirestoreDatabase()) {
      return 'History could not be loaded. Please check your Firebase Realtime Database or Cloud Firestore setup and rules for this signed-in user.';
    }
    if (useRealtimeDatabase()) {
      return 'History could not be loaded. Please check that Firebase Realtime Database exists and that your rules allow this signed-in user to read history.';
    }
    return 'History could not be loaded. Please check that Cloud Firestore exists and that your rules allow this signed-in user to read history.';
  }

  function getHistorySaveMessage() {
    if (useRealtimeDatabase() && useFirestoreDatabase()) {
      return 'History could not be saved. Please check your Firebase Realtime Database or Cloud Firestore setup and rules for this signed-in user.';
    }
    if (useRealtimeDatabase()) {
      return 'History could not be saved. Please check that Firebase Realtime Database exists and that your rules allow this signed-in user to write history.';
    }
    return 'History could not be saved. Please check that Cloud Firestore exists and that your rules allow this signed-in user to write history.';
  }

  function shouldFallbackToFirestore(err) {
    return !!(useFirestoreDatabase() && err);
  }

  async function addHistoryToRealtimeDatabase(userId, entry) {
    var normalized = createHistoryEntry(entry);
    var historyRef = databaseApi.push(databaseApi.ref(rtdb, 'users/' + userId + '/history'));
    await databaseApi.set(historyRef, {
      id: historyRef.key,
      tool: normalized.tool,
      summary: normalized.summary,
      inputName: normalized.inputName,
      inputSize: normalized.inputSize,
      outputSize: normalized.outputSize,
      dimensions: normalized.dimensions,
      format: normalized.format,
      mode: normalized.mode,
      changeSummary: normalized.changeSummary,
      clientHistoryId: normalized.clientHistoryId,
      createdAt: normalized.createdAt
    });
  }

  async function addHistoryToFirestore(userId, entry) {
    var normalized = createHistoryEntry(entry);
    await firestoreApi.addDoc(
      firestoreApi.collection(db, 'users', userId, 'history'),
      {
        tool: normalized.tool,
        summary: normalized.summary,
        inputName: normalized.inputName,
        inputSize: normalized.inputSize,
        outputSize: normalized.outputSize,
        dimensions: normalized.dimensions,
        format: normalized.format,
        mode: normalized.mode,
        changeSummary: normalized.changeSummary,
        clientHistoryId: normalized.clientHistoryId,
        createdAt: firestoreApi.serverTimestamp()
      }
    );
  }

  async function clearRealtimeHistory(userId) {
    await databaseApi.remove(databaseApi.ref(rtdb, 'users/' + userId + '/history'));
  }

  async function clearFirestoreHistory(userId) {
    var snapshot = await firestoreApi.getDocs(
      firestoreApi.collection(db, 'users', userId, 'history')
    );

    await Promise.all(snapshot.docs.map(function(item) {
      return firestoreApi.deleteDoc(item.ref);
    }));
  }

  function normalizeRealtimeHistory(rawHistory) {
    return Object.keys(rawHistory || {}).map(function(key) {
      return createHistoryEntry(rawHistory[key] || {});
    }).sort(function(a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    }).slice(0, HISTORY_LIMIT);
  }

  function normalizeFirestoreHistory(snapshot) {
    return snapshot.docs.map(function(item) {
      var data = createHistoryEntry(item.data() || {});
      data.id = item.id;
      return data;
    });
  }

  function renderHistoryItems(historyList, items) {
    if (!items.length) {
      historyList.innerHTML = '<div class="history-empty">No history yet. Complete a compress, resize, preset, or social export first, then it will appear here.</div>';
      return;
    }

    historyList.innerHTML = items.map(function(data) {
      return '<article class="history-item">' +
        '<div class="history-item-top">' +
        '<div><div class="history-tool">' + escapeHtml(data.tool) + '</div><h3>' + escapeHtml(data.summary) + '</h3></div>' +
        '<div class="history-time">' + escapeHtml(formatDate(data.createdAt)) + '</div>' +
        '</div>' +
        '<div class="history-tags">' +
        '<span>' + escapeHtml(data.inputName) + '</span>' +
        (data.inputSize ? '<span>Input ' + escapeHtml(data.inputSize) + '</span>' : '') +
        (data.outputSize ? '<span>Output ' + escapeHtml(data.outputSize) + '</span>' : '') +
        (data.dimensions ? '<span>' + escapeHtml(data.dimensions) + '</span>' : '') +
        (data.format ? '<span>' + escapeHtml(String(data.format).toUpperCase()) + '</span>' : '') +
        (data.changeSummary ? '<span>' + escapeHtml(data.changeSummary) + '</span>' : '') +
        '</div>' +
        '</article>';
    }).join('');
  }

  function renderLocalHistoryState(historyList, guestState, userState, title, subtitle, items, subtitleText) {
    var localItems = Array.isArray(items) ? items : [];
    if (!localItems.length) return false;

    guestState.style.display = 'none';
    userState.style.display = 'block';
    if (title) title.textContent = 'Recent activity on this device';
    if (subtitle) subtitle.textContent = subtitleText || 'Saved in this browser on this device.';
    renderHistoryItems(historyList, localItems);
    return true;
  }

  async function loadHistoryItems(userId) {
    var lastError = null;

    if (useRealtimeDatabase()) {
      try {
        var historySnapshot = await databaseApi.get(databaseApi.ref(rtdb, 'users/' + userId + '/history'));
        return normalizeRealtimeHistory(historySnapshot.exists() ? (historySnapshot.val() || {}) : {});
      } catch (err) {
        lastError = err;
        console.warn('Realtime Database history load failed, trying Firestore fallback.', err);
      }
    }

    if (useFirestoreDatabase()) {
      try {
        var query = firestoreApi.query(
          firestoreApi.collection(db, 'users', userId, 'history'),
          firestoreApi.orderBy('createdAt', 'desc'),
          firestoreApi.limit(HISTORY_LIMIT)
        );
        var snapshot = await firestoreApi.getDocs(query);
        return normalizeFirestoreHistory(snapshot);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('No Firebase history database is available.');
  }

  async function syncPendingHistory(user) {
    if (!user || !firebaseReady) return 0;
    var pendingItems = getPendingHistoryForUser(user.uid);
    if (!pendingItems.length) return 0;

    var synced = 0;
    for (var i = 0; i < pendingItems.length; i += 1) {
      var item = pendingItems[i];
      if (!item || !item.entry) continue;
      try {
        if (useRealtimeDatabase()) {
          try {
            await addHistoryToRealtimeDatabase(user.uid, item.entry);
          } catch (rtdbErr) {
            if (!shouldFallbackToFirestore(rtdbErr)) throw rtdbErr;
            await addHistoryToFirestore(user.uid, item.entry);
          }
        } else {
          await addHistoryToFirestore(user.uid, item.entry);
        }
        removePendingHistoryItem(item.id);
        synced += 1;
      } catch (err) {
        console.warn('Pending history item still failed to sync.', err);
      }
    }
    return synced;
  }

  function showSetupMessage() {
    var authStatus = document.getElementById('authStatus');
    var historyList = document.getElementById('historyList');
    var panelText = document.getElementById('accountPanelText');
    var guestTitle = document.getElementById('historyTitle');
    var guestSubtitle = document.getElementById('historySubtitle');

    if (authStatus) {
      authStatus.className = 'auth-status error';
      authStatus.style.display = 'block';
      authStatus.textContent = 'Firebase is not configured yet. Open firebase-config.js and paste your Firebase project settings first.';
    }
    if (historyList) {
      historyList.innerHTML = '<div class="history-empty">Firebase is not configured yet. Paste your project values into <strong>firebase-config.js</strong>, then reload this page.</div>';
    }
    if (panelText) {
      panelText.textContent = 'Login across devices needs Firebase. Finish the setup in firebase-config.js, then signed-in users will get cloud-saved history.';
    }
    if (guestTitle) guestTitle.textContent = 'Firebase setup needed';
    if (guestSubtitle) guestSubtitle.textContent = 'Add your Firebase config to enable shared logins and cloud history.';
  }

  function setupThemeToggle() {
    var savedTheme = localStorage.getItem('proresize-theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

    var themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) return;
    themeToggle.addEventListener('click', function() {
      var html = document.documentElement;
      var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('proresize-theme', next);
    });
  }

  function updateNavForUser(user) {
    var authLink = document.getElementById('navAuthLink');
    var logoutBtn = document.getElementById('navLogoutBtn');
    var panelTitle = document.getElementById('accountPanelTitle');
    var panelText = document.getElementById('accountPanelText');
    var primaryAction = document.getElementById('accountPrimaryAction');
    var secondaryAction = document.getElementById('accountSecondaryAction');

    if (authLink) {
      authLink.textContent = user ? ((user.displayName || user.email || 'Account').split(' ')[0]) : 'Login';
      authLink.href = user ? 'history.html' : 'login.html';
    }
    if (logoutBtn) logoutBtn.style.display = user ? 'inline-flex' : 'none';

    if (panelTitle && panelText && primaryAction && secondaryAction) {
      if (user) {
        panelTitle.textContent = 'Welcome back, ' + (user.displayName || user.email);
        panelText.textContent = 'Your completed actions are now saved to Firebase, so you can sign in on another device and see the same history.';
        primaryAction.textContent = 'Continue Editing';
        primaryAction.href = 'index.html';
        secondaryAction.style.display = 'none';
      } else {
        panelTitle.textContent = 'Use ProResize without an account';
        panelText.textContent = 'Login is optional. If you sign in, your processing history is saved to Firebase so the same account works across devices.';
        primaryAction.textContent = 'Login';
        primaryAction.href = 'login.html';
        secondaryAction.textContent = 'View History';
        secondaryAction.href = 'history.html';
        secondaryAction.style.display = 'inline-flex';
      }
    }
  }

  function getCurrentUser() {
    return auth ? auth.currentUser : null;
  }

  function isLoginPage() {
    return window.location.pathname.toLowerCase().indexOf('login.html') !== -1;
  }

  function isHomePage() {
    var path = window.location.pathname.toLowerCase();
    return /\/$/.test(path) || path.indexOf('index.html') !== -1;
  }

  function canUseVerifiedSession(user) {
    if (!user) return false;
    var providers = Array.isArray(user.providerData) ? user.providerData : [];
    var usesPasswordProvider = providers.some(function(item) {
      return item && item.providerId === 'password';
    });
    return !usesPasswordProvider || !!user.emailVerified;
  }

  function redirectSignedInUserToHome(user) {
    if (!user || !isLoginPage() || !canUseVerifiedSession(user)) return;
    window.location.replace('index.html');
  }

  function hideLoginPrompt() {
    var modal = document.getElementById('loginPromptModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    loginPromptClosedForSession = true;
  }

  function maybeShowLoginPrompt(user) {
    var modal = document.getElementById('loginPromptModal');
    if (!modal || !isHomePage()) return;
    if (user) {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      return;
    }
    if (loginPromptClosedForSession) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }

  function setupHomeLoginPrompt() {
    var modal = document.getElementById('loginPromptModal');
    if (!modal) return;

    var closeBtn = document.getElementById('loginPromptClose');
    var skipBtn = document.getElementById('loginPromptSkip');

    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        hideLoginPrompt();
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', function() {
        hideLoginPrompt();
      });
    }

    modal.addEventListener('click', function(e) {
      if (e.target === modal) hideLoginPrompt();
    });
  }

  async function saveProfileToRealtimeDatabase(user, fallbackName, isCreate) {
    var payload = {
      name: fallbackName || user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
      lastLoginAt: Date.now()
    };
    if (isCreate) payload.createdAt = Date.now();

    if (isCreate) {
      await databaseApi.set(databaseApi.ref(rtdb, 'users/' + user.uid + '/profile'), payload);
      return;
    }
    await databaseApi.update(databaseApi.ref(rtdb, 'users/' + user.uid + '/profile'), payload);
  }

  async function saveProfileToFirestore(user, fallbackName, isCreate) {
    var payload = {
      name: fallbackName || user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
      lastLoginAt: firestoreApi.serverTimestamp()
    };
    if (isCreate) payload.createdAt = firestoreApi.serverTimestamp();

    await firestoreApi.setDoc(
      firestoreApi.doc(db, 'users', user.uid),
      payload,
      { merge: true }
    );
  }

  async function saveUserProfileWithFallback(user, fallbackName, isCreate, suppressError) {
    if (!user) return false;
    var lastError = null;

    if (useRealtimeDatabase()) {
      try {
        await saveProfileToRealtimeDatabase(user, fallbackName, isCreate);
        return true;
      } catch (err) {
        lastError = err;
        console.warn('Realtime Database profile save failed, trying Firestore fallback.', err);
      }
    }

    if (useFirestoreDatabase()) {
      try {
        await saveProfileToFirestore(user, fallbackName, isCreate);
        return true;
      } catch (err) {
        lastError = err;
      }
    }

    if (suppressError) {
      if (lastError) {
        console.warn('Profile save skipped because all Firebase backends failed.', lastError);
      }
      return false;
    }

    if (lastError) throw lastError;
    throw new Error('No Firebase profile database is available.');
  }

  async function upsertUserProfile(user) {
    await saveUserProfileWithFallback(user, '', false, true);
  }

  async function createUserProfile(user, fallbackName) {
    await saveUserProfileWithFallback(user, fallbackName || '', true, true);
  }

  async function registerUser(name, email, password) {
    await stateReady;
    if (!firebaseReady) throw new Error('Firebase is not configured yet.');
    if (!name || !email || !password) throw new Error('Please fill in all fields.');
    email = email.trim();

    var existingMethods = await getSignInMethodsForEmail(email);
    if (existingMethods.length) {
      throw buildEmailInUseError(email, existingMethods);
    }

    var credential;
    try {
      credential = await authApi.createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      if (err && err.code === 'auth/email-already-in-use') {
        throw buildEmailInUseError(email, await getSignInMethodsForEmail(email));
      }
      throw err;
    }
    if (name.trim()) {
      await authApi.updateProfile(credential.user, { displayName: name.trim() });
    }

    await authApi.sendEmailVerification(credential.user);

    try {
      await createUserProfile(credential.user, name.trim());
    } catch (profileErr) {
      console.warn('Account created and verification email sent, but profile save failed.', profileErr);
    }
    await authApi.signOut(auth);

    return credential.user;
  }

  async function loginUser(email, password) {
    await stateReady;
    if (!firebaseReady) throw new Error('Firebase is not configured yet.');
    if (!email || !password) throw new Error('Please enter your email and password.');
    var credential = await authApi.signInWithEmailAndPassword(auth, email, password);
    await authApi.reload(credential.user);
    if (!credential.user.emailVerified) {
      try {
        await authApi.sendEmailVerification(credential.user);
      } catch (verificationErr) {
        console.warn('Could not resend verification email.', verificationErr);
      }
      await authApi.signOut(auth);
      var verificationError = new Error('Email not verified.');
      verificationError.code = 'auth/email-not-verified';
      throw verificationError;
    }
    await upsertUserProfile(credential.user);
    return credential.user;
  }

  async function loginWithGoogle() {
    await stateReady;
    if (!firebaseReady) throw new Error('Firebase is not configured yet.');
    if (!googleProvider) throw new Error('Google sign-in is not available right now.');

    var credential = await authApi.signInWithPopup(auth, googleProvider);
    await upsertUserProfile(credential.user);
    return credential.user;
  }

  async function logoutUser() {
    await stateReady;
    if (!firebaseReady || !auth) return;
    await authApi.signOut(auth);
  }

  async function sendPasswordReset(email) {
    await stateReady;
    if (!firebaseReady) throw new Error('Firebase is not configured yet.');
    if (!email) throw new Error('Please enter your email address first.');
    await authApi.sendPasswordResetEmail(auth, email);
  }

  async function addHistory(entry) {
    await stateReady;
    if (!firebaseReady) throw new Error('Firebase is not configured yet.');
    var currentUser = auth && auth.currentUser;
    if (!currentUser) throw new Error('Sign in to save history.');
    var normalized = createHistoryEntry(entry || {});

    if (useRealtimeDatabase()) {
      try {
        await addHistoryToRealtimeDatabase(currentUser.uid, normalized);
        return true;
      } catch (err) {
        if (!shouldFallbackToFirestore(err)) throw err;
        console.warn('Realtime Database history save failed, trying Firestore fallback.', err);
      }
    }

    await addHistoryToFirestore(currentUser.uid, normalized);
    return true;
  }

  async function clearHistory() {
    await stateReady;
    if (!firebaseReady || !auth || !auth.currentUser) return true;
    var userId = auth.currentUser.uid;
    var cleared = false;
    var lastError = null;

    if (useRealtimeDatabase()) {
      try {
        await clearRealtimeHistory(userId);
        cleared = true;
      } catch (err) {
        lastError = err;
        console.warn('Realtime Database history clear failed, trying Firestore fallback.', err);
      }
    }

    if (useFirestoreDatabase()) {
      try {
        await clearFirestoreHistory(userId);
        cleared = true;
      } catch (err) {
        lastError = err;
      }
    }

    if (!cleared && lastError) throw lastError;

    return true;
  }

  function setupLogout() {
    var logoutBtn = document.getElementById('navLogoutBtn');
    if (!logoutBtn) return;

    logoutBtn.addEventListener('click', async function() {
      try {
        await logoutUser();
        if (window.location.pathname.toLowerCase().indexOf('history.html') !== -1) {
          window.location.href = 'login.html';
        }
      } catch (err) {
        alert(err.message || 'Could not log out.');
      }
    });
  }

  function setupLoginPage() {
    var loginForm = document.getElementById('loginForm');
    var registerForm = document.getElementById('registerForm');
    if (!loginForm || !registerForm) return;

    var authTabs = document.getElementById('authTabs');
    var authStatus = document.getElementById('authStatus');
    var loggedInCard = document.getElementById('loggedInCard');
    var loggedInText = document.getElementById('loggedInText');
    var googleLoginBtn = document.getElementById('googleLoginBtn');
    var forgotPasswordBtn = document.getElementById('forgotPasswordBtn');

    function showStatus(message, isError) {
      authStatus.textContent = message;
      authStatus.className = 'auth-status' + (isError ? ' error' : ' success');
      authStatus.style.display = 'block';
    }

    function getResetEmail() {
      var emailInput = document.getElementById('loginEmail');
      var typedEmail = emailInput ? emailInput.value.trim() : '';
      if (typedEmail) return typedEmail;

      var promptedEmail = window.prompt('Enter your registered email address to receive a password reset link:');
      if (!promptedEmail) return '';

      promptedEmail = promptedEmail.trim();
      if (emailInput && promptedEmail) {
        emailInput.value = promptedEmail;
      }
      return promptedEmail;
    }

    function switchTab(tab) {
      authTabs.querySelectorAll('.auth-tab').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.authTab === tab);
      });
      loginForm.style.display = tab === 'login' ? 'grid' : 'none';
      registerForm.style.display = tab === 'register' ? 'grid' : 'none';
    }

    authTabs.addEventListener('click', function(e) {
      var btn = e.target.closest('.auth-tab');
      if (!btn) return;
      switchTab(btn.dataset.authTab);
    });

    stateReady.then(function() {
      var user = getCurrentUser();
      if (user && loggedInCard && loggedInText) {
        loggedInCard.style.display = 'block';
        if (canUseVerifiedSession(user)) {
          loggedInText.textContent = (user.displayName || user.email) + ', you are already signed in. Go straight to the main page or open your history.';
          redirectSignedInUserToHome(user);
        } else {
          loggedInText.textContent = 'Please verify your email before logging in. Check your inbox and spam folder for the verification email.';
        }
      }
      if (!firebaseReady) showSetupMessage();
    });

    loginForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      try {
        await loginUser(
          document.getElementById('loginEmail').value.trim(),
          document.getElementById('loginPassword').value
        );
        showStatus('Login successful. Redirecting to the main page...', false);
        setTimeout(function() {
          window.location.href = 'index.html';
        }, 800);
      } catch (err) {
        showStatus(getAuthErrorMessage(err, 'Invalid email or password.'), true);
      }
    });

    if (forgotPasswordBtn) {
      forgotPasswordBtn.addEventListener('click', async function() {
        var email = getResetEmail();
        if (!email) {
          showStatus('Please enter your registered email address first.', true);
          return;
        }
        try {
          forgotPasswordBtn.disabled = true;
          forgotPasswordBtn.textContent = 'Sending reset link...';
          await sendPasswordReset(email);
          showStatus('Password reset email sent to ' + email + '. Please check your inbox and spam folder.', false);
        } catch (err) {
          showStatus(getAuthErrorMessage(err, 'Could not send password reset email.'), true);
        } finally {
          forgotPasswordBtn.disabled = false;
          forgotPasswordBtn.textContent = 'Send password reset link';
        }
      });
    }

    if (googleLoginBtn) {
      googleLoginBtn.addEventListener('click', async function() {
        try {
          await loginWithGoogle();
          showStatus('Google login successful. Redirecting to the main page...', false);
          setTimeout(function() {
            window.location.href = 'index.html';
          }, 800);
        } catch (err) {
          showStatus(getAuthErrorMessage(err, 'Google login failed.'), true);
        }
      });
    }

    registerForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      try {
        await registerUser(
          document.getElementById('registerName').value.trim(),
          document.getElementById('registerEmail').value.trim(),
          document.getElementById('registerPassword').value
        );
        switchTab('login');
        showStatus('Account created. Verification email sent. Please verify your email, then log in. Check your inbox and spam folder.', false);
      } catch (err) {
        showStatus(getAuthErrorMessage(err, 'Could not create the account.'), true);
      }
    });
  }

  async function renderHistoryPage() {
    var guestState = document.getElementById('historyGuestState');
    var userState = document.getElementById('historyUserState');
    var historyList = document.getElementById('historyList');
    var title = document.getElementById('historyTitle');
    var subtitle = document.getElementById('historySubtitle');
    if (!guestState || !userState || !historyList) return;

    try {
      await stateReady;
    } catch (err) {
      throw err;
    }

    var user = getCurrentUser();
    if (!user) {
      guestState.style.display = 'block';
      userState.style.display = 'none';
      return;
    }

    if (!firebaseReady) {
      guestState.style.display = 'none';
      userState.style.display = 'block';
      if (title) title.textContent = 'Recent activity';
      if (subtitle) subtitle.textContent = 'Firebase is not configured for cloud history yet.';
      renderHistoryItems(historyList, []);
      return;
    }

    guestState.style.display = 'none';
    userState.style.display = 'block';

    if (title) title.textContent = (user.displayName || user.email) + '\'s recent activity';
    if (subtitle) subtitle.textContent = 'Loading recent activity...';

    var cloudItems = await loadHistoryItems(user.uid);
    if (subtitle) {
      if (cloudItems.length) {
        subtitle.textContent = 'Your recent activity appears here.';
      } else {
        subtitle.textContent = 'No recent activity yet. Your completed actions will appear here.';
      }
    }
    renderHistoryItems(historyList, cloudItems);
  }

  function askClearHistoryConfirmation() {
    return new Promise(function(resolve) {
      var modal = document.getElementById('clearHistoryModal');
      var confirmBtn = document.getElementById('confirmClearHistoryBtn');
      var cancelBtn = document.getElementById('cancelClearHistoryBtn');

      if (!modal || !confirmBtn || !cancelBtn) {
        resolve(window.confirm('Are you sure you want to clear your history? This cannot be undone.'));
        return;
      }

      var settled = false;
      var previousOverflow = document.body.style.overflow;

      function cleanup(result) {
        if (settled) return;
        settled = true;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = previousOverflow;
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleBackdropClick);
        document.removeEventListener('keydown', handleKeydown);
        resolve(result);
      }

      function handleConfirm() {
        cleanup(true);
      }

      function handleCancel() {
        cleanup(false);
      }

      function handleBackdropClick(event) {
        if (event.target === modal) cleanup(false);
      }

      function handleKeydown(event) {
        if (event.key === 'Escape') cleanup(false);
      }

      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      modal.addEventListener('click', handleBackdropClick);
      document.addEventListener('keydown', handleKeydown);
      confirmBtn.focus();
    });
  }

  function setupHistoryPage() {
    var clearBtn = document.getElementById('clearHistoryBtn');
    if (clearBtn) {
      clearBtn.onclick = async function() {
        try {
          var confirmed = await askClearHistoryConfirmation();
          if (!confirmed) return;
          clearBtn.disabled = true;
          clearBtn.textContent = 'Clearing...';
          await clearHistory();
          await renderHistoryPage();
        } catch (err) {
          alert(err.message || 'Could not clear history.');
        } finally {
          clearBtn.disabled = false;
          clearBtn.textContent = 'Clear History';
        }
      };
    }

    renderHistoryPage().catch(function(err) {
      console.error(err);
      showRuntimeMessage(getHistoryLoadMessage());
    });
  }

  async function initFirebase() {
    var config = getConfig();
    if (!config) {
      showSetupMessage();
      return;
    }

    var appApi = await import(SDK_BASE + '/firebase-app.js');
    authApi = await import(SDK_BASE + '/firebase-auth.js');
    firestoreApi = await import(SDK_BASE + '/firebase-firestore.js');
    databaseApi = await import(SDK_BASE + '/firebase-database.js');

    var app = appApi.initializeApp(config);
    auth = authApi.getAuth(app);
    db = firestoreApi.getFirestore(app);
    if (config.databaseURL) {
      rtdb = databaseApi.getDatabase(app);
    }
    googleProvider = new authApi.GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    firebaseReady = true;

    await new Promise(function(resolve) {
      var unsub = authApi.onAuthStateChanged(auth, function(user) {
        updateNavForUser(user);
        unsub();
        resolve();
      });
    });

    authApi.onAuthStateChanged(auth, function(user) {
      updateNavForUser(user);
      redirectSignedInUserToHome(user);
      maybeShowLoginPrompt(user);
      if (user) {
        syncPendingHistory(user).catch(function(err) {
          console.warn('Could not sync pending history after auth change.', err);
        });
      }
      if (document.getElementById('historyList')) {
        renderHistoryPage().catch(function(err) {
          console.error(err);
          showRuntimeMessage(getHistoryLoadMessage());
        });
      }
    });
  }

  window.ProResizeAuth = {
    getCurrentUser: getCurrentUser,
    addHistory: function(entry) {
      return addHistory(entry).catch(function(err) {
        console.error(err);
        if (!auth || !auth.currentUser) {
          showRuntimeMessage('Sign in to save history.');
          throw err;
        }
        showRuntimeMessage(getHistorySaveMessage());
        throw err;
      });
    },
    clearHistory: clearHistory
  };

  document.addEventListener('DOMContentLoaded', function() {
    setupThemeToggle();
    updateNavForUser(null);
    setupLogout();
    setupHomeLoginPrompt();

    stateReady = initFirebase().catch(function(err) {
      console.error(err);
      showSetupMessage();
    });

    setupLoginPage();
    setupHistoryPage();
  });
})();
