// src/utils/translation.jsx

// Simple i18n helper for flat keys with {placeholders}
export function t(lang = "en", key, vars = {}) {
  const raw =
    (translations[lang] && translations[lang][key]) ||
    (translations.en && translations.en[key]) ||
    key;
  if (typeof raw !== "string") return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : `{${k}}`
  );
}
export const translations = {
  en: {
    ra_goal_label: "Goal",
    onboarding_help_title: "What would you like help with?",
    onboarding_help_placeholder:
      "e.g., conversational practice for job interviews; past tenses review; travel Spanish…",
    onboarding_help_hint:
      "Share topics, goals, or situations. This guides your AI coach.",
    onboarding_pron_label: "Practice pronunciation",
    onboarding_pron_hint:
      "When enabled, your coach will prompt you to repeat lines and focus on sounds/intonation.",
    // common
    // --- EN additions ---
    ra_title: "Language Learning Coach",
    ra_label_you: "You",
    ra_label_xp: "XP",

    ra_btn_settings: "Settings",
    ra_btn_delete_convo: "Delete conversation",
    ra_btn_connect: "Connect",
    ra_btn_connecting: "Connecting…",
    ra_btn_disconnect: "Disconnect",
    ra_btn_repeat: "Repeat",

    ra_settings_title: "Settings",
    ra_persona_label: "Voice personality",
    ra_persona_placeholder: 'e.g., "{example}"',
    ra_persona_help:
      "Styles the assistant reply (light sarcasm OK; no bullying).",

    ra_progress_header: "Progress",
    ra_progress_xp_to_level: "{remaining} XP to level",

    ra_vad_label: "Auto-stop after pause",

    ra_translating: "Translating…",

    ra_help_label: "What would you like help with?",
    ra_help_help: "Describe your goal or context (this guides the experience).",
    ra_help_placeholder: "e.g., conversational practice for job interviews; past tenses review; travel Spanish…",
    ra_pron_label: "Practice pronunciation",
    ra_pron_help: "Adds a tiny cue and one slow repetition each turn.",

    ra_goal_completed: "Goal completed!",
    ra_goal_skip: "Skip",
    ra_goal_criteria: "Success:",

    ra_delete_confirm:
      "Delete all saved turns for this account? This cannot be undone.",
    ra_toast_no_account_title: "No account",
    ra_toast_no_account_desc: "User ID not found.",
    ra_toast_delete_success: "Conversation deleted",
    ra_toast_delete_failed_title: "Delete failed",
    ra_toast_rt_failed_title: "Realtime connect failed",
    ra_toast_rt_error_title: "Realtime error",

    DEFAULT_PERSONA: "Like a sarcastic, semi-friendly toxica.",
    common_id_label: "ID:",
    common_saving: "Saving",

    // language names (for interpolation)
    language_en: "English",
    language_es: "Spanish",
    language_zh: "Chinese",
    onboarding_voice_alloy: "Alloy",
    onboarding_voice_ash: "Ash",
    onboarding_voice_ballad: "Ballad",
    onboarding_voice_coral: "Coral",
    onboarding_voice_echo: "Echo",
    onboarding_voice_sage: "Sage",
    onboarding_voice_shimmer: "Shimmer",
    onboarding_voice_verse: "Verse",

    // onboarding
    onboarding_title: "Welcome",
    onboarding_subtitle: "Let’s set up your AI experience before you start.",
    onboarding_section_difficulty_support: "Difficulty & Language Support",
    onboarding_section_voice_persona: "Voice & Personality",
    onboarding_section_first_goal: "First goal",

    onboarding_level_beginner: "Beginner",
    onboarding_level_intermediate: "Intermediate",
    onboarding_level_advanced: "Advanced",

    onboarding_support_en: "Support: English",
    onboarding_support_es: "Support: Spanish",
    onboarding_support_zh: "Support: Chinese",

    onboarding_practice_label_title: "Practice language",
    onboarding_practice_es: "Practice: Spanish",
    onboarding_practice_en: "Practice: English",
    onboarding_practice_zh: "Practice: Chinese",

    onboarding_voice_Leda: "Leda",
    onboarding_voice_Puck: "Puck",
    onboarding_voice_Kore: "Kore",
    onboarding_voice_Breeze: "Breeze",
    onboarding_voice_Solemn: "Solemn",

    onboarding_persona_default_example:
      "Like a sarcastic, semi-friendly toxica.",
    onboarding_persona_input_placeholder: "e.g., {example}",
    onboarding_persona_help_text:
      "This guides tone/style (keep it playful, not hurtful).",

    onboarding_translations_toggle: "Show {language} translation",

    onboarding_challenge_default: "Make a polite request.",
    onboarding_challenge_label_en: "EN:",
    onboarding_challenge_label_es: "ES:",

    onboarding_cta_start: "Start my session",

    // app
    app_install_aria: "Install App",
    app_account_aria: "Account",
    app_lang_en: "EN",
    app_lang_es: "ES",
    app_install_title: "Install App",
    app_install_step1:
      "1. Open this page in your browser with the More Options button",
    app_install_step2: "2. Press the Share button",
    app_install_step3: "3. Press the Add To Homescreen button",
    app_install_step4:
      "4. That’s it! You don’t need to download the app through an app store because we’re using open-source standards called Progressive Web Apps.",
    app_close: "Close",
    app_account_title: "Account",
    app_your_id: "Your ID (npub)",
    app_copy: "Copy",
    app_secret_key: "Secret key (nsec)",
    app_secret_note:
      "We never display your secret—only copy from local storage.",
    app_switch_account: "Switch account (paste nsec)",
    app_nsec_placeholder: "nsec1...",
    app_switch: "Switch",
    app_switching: "Switching",
    app_switch_note:
      "If the account doesn’t exist, we’ll create it in your users collection.",

    // toasts
    toast_copied: "Copied",
    toast_id_copied: "ID copied",
    toast_secret_copied: "Secret copied",
    toast_copy_failed: "Copy failed",
    toast_paste_nsec: "Paste your nsec first",
    toast_invalid_key: "Invalid key",
    toast_must_start_nsec: "Must start with nsec…",
    toast_switch_failed: "Switch failed",
    toast_switched_account: "Switched account",
    toast_save_lang_failed: "Failed to save language",
    "passcode.instructions":
      "Enter your passcode to continue. If you’re a Patreon supporter, check your welcome message for the code.",
    "passcode.label": "Passcode",
    backToQuestion9: "Back to Question 9",
  },

  es: {
    ra_goal_label: "Meta",
    onboarding_help_title: "¿En qué te gustaría recibir ayuda?",
    onboarding_help_placeholder:
      "p. ej., práctica conversacional para entrevistas de trabajo; repaso de tiempos pasados; español para viajar…",
    onboarding_help_hint:
      "Comparte temas, metas o situaciones. Esto guía a tu coach de IA.",
    onboarding_pron_label: "Practicar pronunciación",
    onboarding_pron_hint:
      "Al activarlo, tu coach te pedirá repetir frases y se enfocará en los sonidos y la entonación.",
    "passcode.instructions":
      "Ingresa tu código de acceso para continuar. Si eres patrocinador en Patreon, revisa tu mensaje de bienvenida para encontrar el código.",
    "passcode.label": "Código de acceso",
    backToQuestion9: "Volver a la pregunta 9",
    // common
    DEFAULT_PERSONA: "Como una tóxica sarcástica y semi-amistosa",
    common_id_label: "ID:",
    common_saving: "Guardando",

    // language names (for interpolation)
    language_en: "Inglés",
    language_es: "Español",
    language_zh: "Chino",

    onboarding_voice_alloy: "Alloy",
    onboarding_voice_ash: "Ash",
    onboarding_voice_ballad: "Ballad",
    onboarding_voice_coral: "Coral",
    onboarding_voice_echo: "Echo",
    onboarding_voice_sage: "Sage",
    onboarding_voice_shimmer: "Shimmer",
    onboarding_voice_verse: "Verse",

    // onboarding
    onboarding_title: "Bienvenido",
    onboarding_subtitle: "Configura tu experiencia de IA antes de empezar.",
    onboarding_section_difficulty_support: "Dificultad y apoyo de idioma",
    onboarding_section_voice_persona: "Voz y personalidad",
    onboarding_section_first_goal: "Primer objetivo",

    onboarding_level_beginner: "Principiante",
    onboarding_level_intermediate: "Intermedio",
    onboarding_level_advanced: "Avanzado",

    onboarding_support_en: "Apoyo: Inglés",
    onboarding_support_es: "Apoyo: Español",
    onboarding_support_zh: "Apoyo: Chino",

    onboarding_practice_label_title: "Idioma de práctica",
    onboarding_practice_es: "Práctica: Español",
    onboarding_practice_en: "Práctica: Inglés",
    onboarding_practice_zh: "Práctica: Chino",

    onboarding_voice_Leda: "Leda",
    onboarding_voice_Puck: "Puck",
    onboarding_voice_Kore: "Kore",
    onboarding_voice_Breeze: "Breeze",
    onboarding_voice_Solemn: "Solemn",

    onboarding_persona_default_example:
      "Como una tóxica sarcástica y medio amistosa.",
    onboarding_persona_input_placeholder: "p. ej., {example}",
    onboarding_persona_help_text:
      "Esto guía el tono/estilo (que sea juguetón, no hiriente).",

    onboarding_translations_toggle: "Mostrar traducción en {language}",

    onboarding_challenge_default: "Pide algo con cortesía.",
    onboarding_challenge_label_en: "EN:",
    onboarding_challenge_label_es: "ES:",

    onboarding_cta_start: "Iniciar mi sesión",
    // --- ES additions ---
    ra_title: "Entrenador de Idiomas",
    ra_label_you: "Tú",
    ra_label_xp: "XP",

    ra_btn_settings: "Ajustes",
    ra_btn_delete_convo: "Borrar conversación",
    ra_btn_connect: "Conectar",
    ra_btn_connecting: "Conectando…",
    ra_btn_disconnect: "Desconectar",
    ra_btn_repeat: "Repetir",

    ra_settings_title: "Ajustes",
    ra_persona_label: "Personalidad de voz",
    ra_persona_placeholder: 'p. ej., "{example}"',
    ra_persona_help:
      "Define el estilo de la respuesta (sarcasmo ligero OK; nada hiriente).",

    ra_progress_header: "Progreso",
    ra_progress_xp_to_level: "{remaining} XP para subir de nivel",

    ra_vad_label: "Detener automáticamente tras pausa",

    ra_translating: "Traduciendo…",

    ra_help_label: "¿En qué te gustaría recibir ayuda?",
    ra_help_help: "Describe tu meta o contexto (esto guía la experiencia).",
    ra_help_placeholder: "p. ej., práctica conversacional para entrevistas de trabajo; repaso de tiempos pasados; español para viajar…",
    ra_pron_label: "Practicar pronunciación",
    ra_pron_help: "Añade una micro-pista y una repetición lenta en cada turno.",

    ra_goal_completed: "¡Meta lograda!",
    ra_goal_skip: "Saltar",
    ra_goal_criteria: "Éxito:",

    ra_delete_confirm:
      "¿Borrar todos los turnos guardados de esta cuenta? Esta acción no se puede deshacer.",
    ra_toast_no_account_title: "Sin cuenta",
    ra_toast_no_account_desc: "No se encontró el ID de usuario.",
    ra_toast_delete_success: "Conversación borrada",
    ra_toast_delete_failed_title: "Error al borrar",
    ra_toast_rt_failed_title: "Fallo de conexión en tiempo real",
    ra_toast_rt_error_title: "Error de Realtime",

    // app
    app_install_aria: "Instalar App",
    app_account_aria: "Cuenta",
    app_lang_en: "EN",
    app_lang_es: "ES",
    app_install_title: "Instalar App",
    app_install_step1:
      "1. Abre esta página en tu navegador con el botón de Más Opciones",
    app_install_step2: "2. Presiona el botón de Compartir",
    app_install_step3:
      "3. Presiona el botón de Agregar a la Pantalla de Inicio",
    app_install_step4:
      "4. ¡Eso es todo! No necesitas descargar la app a través de una tienda de apps porque usamos estándares de código abierto llamados Progressive Web Apps.",
    app_close: "Cerrar",
    app_account_title: "Cuenta",
    app_your_id: "Tu ID (npub)",
    app_copy: "Copiar",
    app_secret_key: "Clave secreta (nsec)",
    app_secret_note:
      "Nunca mostramos tu secreto—solo copiamos desde el almacenamiento local.",
    app_switch_account: "Cambiar cuenta (pega nsec)",
    app_nsec_placeholder: "nsec1...",
    app_switch: "Cambiar",
    app_switching: "Cambiando",
    app_switch_note:
      "Si la cuenta no existe, la crearemos en tu colección de usuarios.",

    // toasts
    toast_copied: "Copiado",
    toast_id_copied: "ID copiado",
    toast_secret_copied: "Secreto copiado",
    toast_copy_failed: "Fallo al copiar",
    toast_paste_nsec: "Pega tu nsec primero",
    toast_invalid_key: "Clave inválida",
    toast_must_start_nsec: "Debe empezar con nsec…",
    toast_switch_failed: "Fallo al cambiar",
    toast_switched_account: "Cuenta cambiada",
    toast_save_lang_failed: "Fallo al guardar idioma",
  },
};

export default translations;
