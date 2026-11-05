// The UI language, and every string the user reads.
//
// This is a table in the extension rather than browser.i18n and _locales/,
// because browser.i18n resolves against the *browser's* UI locale when the
// extension loads and has no runtime override -- no setLocale, no way back. An
// extension built on it can be translated but not switched, and the point here is
// a switch in Settings that takes effect at once. _locales/ is still used, for
// the three manifest strings Firefox renders in about:addons and the toolbar,
// which no extension can repaint at runtime.
//
// Adding a language means adding one block to MESSAGES and a name to NAMES, plus
// its _locales/ folder and its AMO listing, which the tests insist on. Nothing
// else holds a user-facing string: lib/calc.js returns keys and numbers, and the
// popup and the content script render them through render() and t().
(function (root) {
  'use strict';

  const DEFAULT = 'en';

  // Language names are written in their own language, as they are everywhere
  // else, so the picker is readable whichever language is active.
  //
  // The codes are BCP 47 tags ('pt-BR', 'zh-TW') because they go straight into
  // <html lang> and Intl.DisplayNames, and the lang attribute is what makes a
  // browser draw Han characters in the Traditional, Simplified or Japanese form.
  // _locales/ spells the same codes with an underscore ('zh_TW'), as browsers
  // require there.
  const NAMES = {
    en: 'English',
    sv: 'Svenska',
    de: 'Deutsch',
    es: 'Español',
    'pt-BR': 'Português (Brasil)',
    fr: 'Français',
    ja: '日本語',
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
  };

  const MESSAGES = {
    en: {
      // The decimal separator for every number t() fills in: '1.2 days' here,
      // '1,2 dagar' in Swedish. A symbol, so it is exempt from the check for
      // untranslated strings.
      'format.decimal': '.',

      'nav.settings': 'SETTINGS',
      'nav.settingsTitle': 'Settings',
      'price.label': 'Price',
      'price.currencyLabel': 'Currency of this price',

      'result.ofYourLife': 'of your life',
      'result.copy': 'COPY',
      'result.copied': 'COPIED',
      'result.copyFailed': 'COPY FAILED',
      'result.overflowDays': '+{days} days',

      'history.title': 'HISTORY',
      'history.empty': 'Nothing checked yet.',
      'history.clear': 'CLEAR HISTORY',
      'history.total': '{time} total',

      'site.title': 'THIS SITE',
      'site.disable': 'Disable on this site',
      'site.forceCurrency': 'Force currency on this site',
      'site.autoDetect': 'Auto-detect',

      'rates.attribution': 'Rates by ExchangeRate-API',
      'rates.refresh': 'REFRESH',
      'rates.none': 'No rates yet',
      'rates.updated': 'Rates updated {date} · {source}',
      'rates.unknownDate': 'unknown',
      'rates.unknownDateLong': 'unknown date',
      'rates.sourceSnapshot': 'bundled snapshot',
      'rates.noRateFor': 'No rate for {code} yet. Try Refresh, or pick another currency.',
      'rates.noneYetShort': 'no rates yet',
      'rates.unavailable': 'rate unavailable ({source}, {date})',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun':
        'One thing first: what do you earn after tax? It stays on this machine.',
      'settings.income': 'INCOME',
      'settings.monthly': 'Monthly, after tax',
      'settings.monthlyLabel': 'Monthly after-tax income',
      'settings.hourly': 'Hourly, after tax',
      'settings.hourlyLabel': 'Hourly after-tax rate',
      'settings.hoursPerWeek': 'Hours worked per week',
      'settings.homeCurrency': 'Home currency',
      'settings.showBadges': 'Show badges next to prices on pages',
      'settings.language': 'Language',
      'settings.save': 'SAVE',
      'settings.back': 'BACK',
      'settings.errorHourly': 'Enter an hourly rate above zero.',
      'settings.errorMonthly': 'Enter a monthly income above zero, and hours per week.',

      // A named weekday standing in for one ordinary working day. Each language
      // picks its own idiom for that; it is not a word-for-word translation.
      'framing.coffeeBreak': 'A coffee break',
      'framing.quickErrand': 'A quick errand',
      'framing.halfWorkday': 'Half your workday',
      'framing.wholeWorkday': 'Your whole Tuesday',
      'framing.daysOfLife': '{days} days of your life',
      'framing.wholeWorkWeek': 'Your whole work week',
      'framing.workWeeks': '{weeks} work weeks',

      'time.hoursMinutes': '{hours} h {minutes} min',
      'time.hours': '{hours} h',
      'time.minutes': '{minutes} min',

      'badge.hoursMinutes': '{hours}h{minutes}m',
      'badge.hours': '{hours}h',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}d',
      // The honest answer when a price cannot be converted. A symbol, so it is
      // the same in every language, but it lives here so render() can reach it.
      'badge.unknown': '?',
      // Said in the tooltip after an '=', and said on its own as the badge's
      // accessible name, so a screen reader hears the sentence rather than the
      // compact '5.2d'.
      'badge.workTime': '{time} of your work',
      'badge.noRate': 'No exchange rate for {what}, so this is not converted.',
      'badge.thisCurrency': 'this currency',

      'share.clipboard': '{price} = {time} of my life. Worth it?',
    },

    sv: {
      'format.decimal': ',',

      'nav.settings': 'INSTÄLLNINGAR',
      'nav.settingsTitle': 'Inställningar',
      'price.label': 'Pris',
      'price.currencyLabel': 'Valuta för priset',

      'result.ofYourLife': 'av ditt liv',
      'result.copy': 'KOPIERA',
      'result.copied': 'KOPIERAT',
      'result.copyFailed': 'KOPIERING MISSLYCKADES',
      'result.overflowDays': '+{days} dagar',

      'history.title': 'HISTORIK',
      'history.empty': 'Inget kontrollerat än.',
      'history.clear': 'RENSA HISTORIK',
      'history.total': '{time} totalt',

      'site.title': 'DEN HÄR SIDAN',
      'site.disable': 'Stäng av på den här sidan',
      'site.forceCurrency': 'Tvinga valuta på den här sidan',
      'site.autoDetect': 'Identifiera automatiskt',

      'rates.attribution': 'Växelkurser från ExchangeRate-API',
      'rates.refresh': 'UPPDATERA',
      'rates.none': 'Inga kurser än',
      'rates.updated': 'Kurser uppdaterade {date} · {source}',
      'rates.unknownDate': 'okänt',
      'rates.unknownDateLong': 'okänt datum',
      'rates.sourceSnapshot': 'medföljande kopia',
      'rates.noRateFor': 'Ingen kurs för {code} än. Prova Uppdatera, eller välj en annan valuta.',
      'rates.noneYetShort': 'inga kurser än',
      'rates.unavailable': 'kurs saknas ({source}, {date})',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun':
        'En sak först: vad tjänar du efter skatt? Det stannar på den här datorn.',
      'settings.income': 'INKOMST',
      'settings.monthly': 'Per månad, efter skatt',
      'settings.monthlyLabel': 'Månadsinkomst efter skatt',
      'settings.hourly': 'Per timme, efter skatt',
      'settings.hourlyLabel': 'Timlön efter skatt',
      'settings.hoursPerWeek': 'Arbetstimmar per vecka',
      'settings.homeCurrency': 'Din valuta',
      'settings.showBadges': 'Visa märken vid priser på sidor',
      'settings.language': 'Språk',
      'settings.save': 'SPARA',
      'settings.back': 'TILLBAKA',
      'settings.errorHourly': 'Ange en timlön över noll.',
      'settings.errorMonthly': 'Ange en månadsinkomst över noll, och timmar per vecka.',

      // 'En fika' is the idiom a Swede would reach for here, and it is the same
      // length of time the English line means.
      'framing.coffeeBreak': 'En fikapaus',
      'framing.quickErrand': 'Ett snabbt ärende',
      'framing.halfWorkday': 'Halva din arbetsdag',
      'framing.wholeWorkday': 'Hela din tisdag',
      'framing.daysOfLife': '{days} dagar av ditt liv',
      'framing.wholeWorkWeek': 'Hela din arbetsvecka',
      'framing.workWeeks': '{weeks} arbetsveckor',

      'time.hoursMinutes': '{hours} tim {minutes} min',
      'time.hours': '{hours} tim',
      'time.minutes': '{minutes} min',

      'badge.hoursMinutes': '{hours}t{minutes}m',
      'badge.hours': '{hours}t',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}d',
      'badge.unknown': '?',
      'badge.workTime': '{time} av ditt arbete',
      'badge.noRate': 'Ingen växelkurs för {what}, så detta är inte omräknat.',
      'badge.thisCurrency': 'den här valutan',

      'share.clipboard': '{price} = {time} av mitt liv. Värt det?',
    },

    // The seven below are machine translations (#94), awaiting review by native
    // speakers. Each addresses the reader informally, as the English and the
    // Swedish do -- du, tú, você -- except French, where software addresses its
    // reader as vous and tu would read as over-familiar.

    // French typography puts a no-break space before ? and : so they never
    // wrap onto a line of their own, hence the \u00a0.
    fr: {
      'format.decimal': ',',

      'nav.settings': 'RÉGLAGES',
      'nav.settingsTitle': 'Réglages',
      'price.label': 'Prix',
      'price.currencyLabel': 'Devise de ce prix',

      'result.ofYourLife': 'de votre vie',
      'result.copy': 'COPIER',
      'result.copied': 'COPIÉ',
      'result.copyFailed': 'ÉCHEC DE LA COPIE',
      'result.overflowDays': '+{days} jours',

      'history.title': 'HISTORIQUE',
      'history.empty': 'Rien de vérifié pour l’instant.',
      'history.clear': 'EFFACER L’HISTORIQUE',
      'history.total': '{time} au total',

      'site.title': 'CE SITE',
      'site.disable': 'Désactiver sur ce site',
      'site.forceCurrency': 'Forcer la devise sur ce site',
      'site.autoDetect': 'Détection automatique',

      'rates.attribution': 'Taux fournis par ExchangeRate-API',
      'rates.refresh': 'ACTUALISER',
      'rates.none': 'Pas encore de taux',
      'rates.updated': 'Taux mis à jour le {date} · {source}',
      'rates.unknownDate': 'inconnue',
      'rates.unknownDateLong': 'date inconnue',
      'rates.sourceSnapshot': 'copie intégrée',
      'rates.noRateFor':
        'Pas encore de taux pour {code}. Essayez Actualiser ou choisissez une autre devise.',
      'rates.noneYetShort': 'pas encore de taux',
      'rates.unavailable': 'taux indisponible ({source}, {date})',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun':
        'Une chose d’abord\u00a0: combien gagnez-vous après impôts\u00a0? Cela reste sur cet appareil.',
      'settings.income': 'REVENUS',
      'settings.monthly': 'Mensuel, après impôts',
      'settings.monthlyLabel': 'Revenu mensuel après impôts',
      'settings.hourly': 'Horaire, après impôts',
      'settings.hourlyLabel': 'Taux horaire après impôts',
      'settings.hoursPerWeek': 'Heures travaillées par semaine',
      'settings.homeCurrency': 'Votre devise',
      'settings.showBadges': 'Afficher des badges à côté des prix sur les pages',
      'settings.language': 'Langue',
      'settings.save': 'ENREGISTRER',
      'settings.back': 'RETOUR',
      'settings.errorHourly': 'Saisissez un taux horaire supérieur à zéro.',
      'settings.errorMonthly':
        'Saisissez un revenu mensuel supérieur à zéro, et les heures par semaine.',

      'framing.coffeeBreak': 'Une pause café',
      'framing.quickErrand': 'Une petite course',
      'framing.halfWorkday': 'La moitié de votre journée',
      'framing.wholeWorkday': 'Tout votre mardi',
      'framing.daysOfLife': '{days} jours de votre vie',
      'framing.wholeWorkWeek': 'Toute votre semaine de travail',
      'framing.workWeeks': '{weeks} semaines de travail',

      'time.hoursMinutes': '{hours} h {minutes} min',
      'time.hours': '{hours} h',
      'time.minutes': '{minutes} min',

      'badge.hoursMinutes': '{hours}h{minutes}m',
      'badge.hours': '{hours}h',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}j',
      'badge.unknown': '?',
      'badge.workTime': '{time} de votre travail',
      'badge.noRate': 'Aucun taux de change pour {what}, ce prix n’est donc pas converti.',
      'badge.thisCurrency': 'cette devise',

      'share.clipboard': '{price} = {time} de ma vie. Ça vaut le coup\u00a0?',
    },

    de: {
      'format.decimal': ',',

      'nav.settings': 'EINSTELLUNGEN',
      'nav.settingsTitle': 'Einstellungen',
      'price.label': 'Preis',
      'price.currencyLabel': 'Währung dieses Preises',

      'result.ofYourLife': 'deines Lebens',
      'result.copy': 'KOPIEREN',
      'result.copied': 'KOPIERT',
      'result.copyFailed': 'KOPIEREN FEHLGESCHLAGEN',
      'result.overflowDays': '+{days} Tage',

      'history.title': 'VERLAUF',
      'history.empty': 'Noch nichts geprüft.',
      'history.clear': 'VERLAUF LÖSCHEN',
      'history.total': '{time} insgesamt',

      'site.title': 'DIESE SEITE',
      'site.disable': 'Auf dieser Seite deaktivieren',
      'site.forceCurrency': 'Währung für diese Seite festlegen',
      'site.autoDetect': 'Automatisch erkennen',

      'rates.attribution': 'Kurse von ExchangeRate-API',
      'rates.refresh': 'AKTUALISIEREN',
      'rates.none': 'Noch keine Kurse',
      'rates.updated': 'Kurse aktualisiert {date} · {source}',
      'rates.unknownDate': 'unbekannt',
      'rates.unknownDateLong': 'unbekanntes Datum',
      'rates.sourceSnapshot': 'mitgelieferte Kopie',
      'rates.noRateFor':
        'Noch kein Kurs für {code}. Versuche Aktualisieren oder wähle eine andere Währung.',
      'rates.noneYetShort': 'noch keine Kurse',
      'rates.unavailable': 'Kurs nicht verfügbar ({source}, {date})',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun':
        'Eine Sache vorab: Was verdienst du netto? Es bleibt auf diesem Gerät.',
      'settings.income': 'EINKOMMEN',
      'settings.monthly': 'Monatlich, netto',
      'settings.monthlyLabel': 'Monatliches Nettoeinkommen',
      'settings.hourly': 'Pro Stunde, netto',
      'settings.hourlyLabel': 'Nettostundenlohn',
      'settings.hoursPerWeek': 'Arbeitsstunden pro Woche',
      'settings.homeCurrency': 'Deine Währung',
      'settings.showBadges': 'Badges neben Preisen auf Webseiten anzeigen',
      'settings.language': 'Sprache',
      'settings.save': 'SPEICHERN',
      'settings.back': 'ZURÜCK',
      'settings.errorHourly': 'Gib einen Stundenlohn über null ein.',
      'settings.errorMonthly': 'Gib ein Monatseinkommen über null und die Stunden pro Woche ein.',

      'framing.coffeeBreak': 'Eine Kaffeepause',
      'framing.quickErrand': 'Eine kurze Besorgung',
      'framing.halfWorkday': 'Dein halber Arbeitstag',
      'framing.wholeWorkday': 'Dein ganzer Dienstag',
      'framing.daysOfLife': '{days} Tage deines Lebens',
      'framing.wholeWorkWeek': 'Deine ganze Arbeitswoche',
      'framing.workWeeks': '{weeks} Arbeitswochen',

      'time.hoursMinutes': '{hours} Std. {minutes} Min.',
      'time.hours': '{hours} Std.',
      'time.minutes': '{minutes} Min.',

      'badge.hoursMinutes': '{hours}h{minutes}m',
      'badge.hours': '{hours}h',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}T',
      'badge.unknown': '?',
      'badge.workTime': '{time} deiner Arbeit',
      'badge.noRate': 'Kein Wechselkurs für {what}, daher nicht umgerechnet.',
      'badge.thisCurrency': 'diese Währung',

      'share.clipboard': '{price} = {time} meines Lebens. Lohnt sich das?',
    },

    es: {
      'format.decimal': ',',

      'nav.settings': 'AJUSTES',
      'nav.settingsTitle': 'Ajustes',
      'price.label': 'Precio',
      'price.currencyLabel': 'Moneda de este precio',

      'result.ofYourLife': 'de tu vida',
      'result.copy': 'COPIAR',
      'result.copied': 'COPIADO',
      'result.copyFailed': 'ERROR AL COPIAR',
      'result.overflowDays': '+{days} días',

      'history.title': 'HISTORIAL',
      'history.empty': 'Aún no has comprobado nada.',
      'history.clear': 'BORRAR HISTORIAL',
      'history.total': '{time} en total',

      'site.title': 'ESTE SITIO',
      'site.disable': 'Desactivar en este sitio',
      'site.forceCurrency': 'Forzar moneda en este sitio',
      'site.autoDetect': 'Detectar automáticamente',

      'rates.attribution': 'Tipos de cambio de ExchangeRate-API',
      'rates.refresh': 'ACTUALIZAR',
      'rates.none': 'Aún no hay tipos de cambio',
      'rates.updated': 'Tipos actualizados {date} · {source}',
      'rates.unknownDate': 'desconocida',
      'rates.unknownDateLong': 'fecha desconocida',
      'rates.sourceSnapshot': 'copia incluida',
      'rates.noRateFor':
        'Aún no hay tipo de cambio para {code}. Prueba Actualizar o elige otra moneda.',
      'rates.noneYetShort': 'aún sin tipos de cambio',
      'rates.unavailable': 'tipo de cambio no disponible ({source}, {date})',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun':
        'Antes de nada: ¿cuánto ganas después de impuestos? Se queda en este equipo.',
      'settings.income': 'INGRESOS',
      'settings.monthly': 'Mensual, después de impuestos',
      'settings.monthlyLabel': 'Ingresos mensuales después de impuestos',
      'settings.hourly': 'Por hora, después de impuestos',
      'settings.hourlyLabel': 'Tarifa por hora después de impuestos',
      'settings.hoursPerWeek': 'Horas trabajadas por semana',
      'settings.homeCurrency': 'Tu moneda',
      'settings.showBadges': 'Mostrar distintivos junto a los precios en las páginas',
      'settings.language': 'Idioma',
      'settings.save': 'GUARDAR',
      'settings.back': 'VOLVER',
      'settings.errorHourly': 'Introduce una tarifa por hora mayor que cero.',
      'settings.errorMonthly':
        'Introduce unos ingresos mensuales mayores que cero y las horas por semana.',

      'framing.coffeeBreak': 'Una pausa para el café',
      'framing.quickErrand': 'Un recado rápido',
      'framing.halfWorkday': 'Media jornada laboral',
      'framing.wholeWorkday': 'Todo tu martes',
      'framing.daysOfLife': '{days} días de tu vida',
      'framing.wholeWorkWeek': 'Toda tu semana laboral',
      'framing.workWeeks': '{weeks} semanas laborales',

      'time.hoursMinutes': '{hours} h {minutes} min',
      'time.hours': '{hours} h',
      'time.minutes': '{minutes} min',

      'badge.hoursMinutes': '{hours}h{minutes}m',
      'badge.hours': '{hours}h',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}d',
      'badge.unknown': '?',
      'badge.workTime': '{time} de tu trabajo',
      'badge.noRate': 'No hay tipo de cambio para {what}, así que no se ha convertido.',
      'badge.thisCurrency': 'esta moneda',

      'share.clipboard': '{price} = {time} de mi vida. ¿Vale la pena?',
    },

    // Brazilian Portuguese, and the table a browser set to pt-PT gets too:
    // closer to what the reader expects than English is.
    'pt-BR': {
      'format.decimal': ',',

      'nav.settings': 'CONFIGURAÇÕES',
      'nav.settingsTitle': 'Configurações',
      'price.label': 'Preço',
      'price.currencyLabel': 'Moeda deste preço',

      'result.ofYourLife': 'da sua vida',
      'result.copy': 'COPIAR',
      'result.copied': 'COPIADO',
      'result.copyFailed': 'FALHA AO COPIAR',
      'result.overflowDays': '+{days} dias',

      'history.title': 'HISTÓRICO',
      'history.empty': 'Nada verificado ainda.',
      'history.clear': 'LIMPAR HISTÓRICO',
      'history.total': '{time} no total',

      'site.title': 'ESTE SITE',
      'site.disable': 'Desativar neste site',
      'site.forceCurrency': 'Forçar moeda neste site',
      'site.autoDetect': 'Detectar automaticamente',

      'rates.attribution': 'Cotações por ExchangeRate-API',
      'rates.refresh': 'ATUALIZAR',
      'rates.none': 'Nenhuma cotação ainda',
      'rates.updated': 'Cotações atualizadas {date} · {source}',
      'rates.unknownDate': 'desconhecida',
      'rates.unknownDateLong': 'data desconhecida',
      'rates.sourceSnapshot': 'cópia incluída',
      'rates.noRateFor':
        'Ainda não há cotação para {code}. Tente Atualizar ou escolha outra moeda.',
      'rates.noneYetShort': 'nenhuma cotação ainda',
      'rates.unavailable': 'cotação indisponível ({source}, {date})',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun':
        'Antes de tudo: quanto você ganha líquido? Isso fica só neste dispositivo.',
      'settings.income': 'RENDA',
      'settings.monthly': 'Mensal, líquido',
      'settings.monthlyLabel': 'Renda mensal líquida',
      'settings.hourly': 'Por hora, líquido',
      'settings.hourlyLabel': 'Valor por hora líquido',
      'settings.hoursPerWeek': 'Horas trabalhadas por semana',
      'settings.homeCurrency': 'Sua moeda',
      'settings.showBadges': 'Mostrar selos ao lado dos preços nas páginas',
      'settings.language': 'Idioma',
      'settings.save': 'SALVAR',
      'settings.back': 'VOLTAR',
      'settings.errorHourly': 'Informe um valor por hora acima de zero.',
      'settings.errorMonthly': 'Informe uma renda mensal acima de zero e as horas por semana.',

      // 'Um cafezinho' is the Brazilian idiom for a short coffee break.
      'framing.coffeeBreak': 'Um cafezinho',
      'framing.quickErrand': 'Uma tarefa rápida',
      'framing.halfWorkday': 'Metade do seu dia de trabalho',
      'framing.wholeWorkday': 'Sua terça-feira inteira',
      'framing.daysOfLife': '{days} dias da sua vida',
      'framing.wholeWorkWeek': 'Sua semana de trabalho inteira',
      'framing.workWeeks': '{weeks} semanas de trabalho',

      'time.hoursMinutes': '{hours} h {minutes} min',
      'time.hours': '{hours} h',
      'time.minutes': '{minutes} min',

      'badge.hoursMinutes': '{hours}h{minutes}m',
      'badge.hours': '{hours}h',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}d',
      'badge.unknown': '?',
      'badge.workTime': '{time} do seu trabalho',
      'badge.noRate': 'Sem cotação para {what}, então não foi convertido.',
      'badge.thisCurrency': 'esta moeda',

      'share.clipboard': '{price} = {time} da minha vida. Vale a pena?',
    },

    // Japanese and Chinese have no letter case, so the strings English writes
    // in capitals are simply the word. 'result.ofYourLife' follows the time it
    // qualifies ('3時間45分の人生'), so it carries the particle that joins them.
    ja: {
      'format.decimal': '.',

      'nav.settings': '設定',
      'nav.settingsTitle': '設定',
      'price.label': '価格',
      'price.currencyLabel': 'この価格の通貨',

      'result.ofYourLife': 'の人生',
      'result.copy': 'コピー',
      'result.copied': 'コピーしました',
      'result.copyFailed': 'コピーに失敗しました',
      'result.overflowDays': '+{days}日',

      'history.title': '履歴',
      'history.empty': 'まだ何も確認していません。',
      'history.clear': '履歴を消去',
      'history.total': '合計 {time}',

      'site.title': 'このサイト',
      'site.disable': 'このサイトで無効にする',
      'site.forceCurrency': 'このサイトの通貨を固定',
      'site.autoDetect': '自動検出',

      'rates.attribution': '為替レート提供: ExchangeRate-API',
      'rates.refresh': '更新',
      'rates.none': 'レートはまだありません',
      'rates.updated': 'レート更新 {date} · {source}',
      'rates.unknownDate': '不明',
      'rates.unknownDateLong': '日付不明',
      'rates.sourceSnapshot': '同梱データ',
      'rates.noRateFor':
        '{code} のレートはまだありません。更新を試すか、別の通貨を選んでください。',
      'rates.noneYetShort': 'レートなし',
      'rates.unavailable': 'レートを取得できません（{source}、{date}）',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun':
        'まず最初に：手取りの収入はいくらですか？この情報はこの端末から出ません。',
      'settings.income': '収入',
      'settings.monthly': '月額（手取り）',
      'settings.monthlyLabel': '手取り月収',
      'settings.hourly': '時給（手取り）',
      'settings.hourlyLabel': '手取り時給',
      'settings.hoursPerWeek': '週の労働時間',
      'settings.homeCurrency': '基準通貨',
      'settings.showBadges': 'ページ上の価格の横にバッジを表示',
      'settings.language': '言語',
      'settings.save': '保存',
      'settings.back': '戻る',
      'settings.errorHourly': '0より大きい時給を入力してください。',
      'settings.errorMonthly': '0より大きい月収と、週の労働時間を入力してください。',

      'framing.coffeeBreak': 'コーヒー休憩ひとつ分',
      'framing.quickErrand': 'ちょっとした用事ひとつ分',
      'framing.halfWorkday': '勤務日の半分',
      'framing.wholeWorkday': '火曜日まるごと',
      'framing.daysOfLife': '人生の{days}日分',
      'framing.wholeWorkWeek': '1週間の勤務まるごと',
      'framing.workWeeks': '{weeks}週間分の勤務',

      'time.hoursMinutes': '{hours}時間{minutes}分',
      'time.hours': '{hours}時間',
      'time.minutes': '{minutes}分',

      // The badge sits inline in someone else's page, so it keeps the compact
      // Latin h/m; only the day unit, which has no such convention, is native.
      'badge.hoursMinutes': '{hours}h{minutes}m',
      'badge.hours': '{hours}h',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}日',
      'badge.unknown': '?',
      'badge.workTime': '労働時間 {time}',
      'badge.noRate': '{what}の為替レートがないため、換算していません。',
      'badge.thisCurrency': 'この通貨',

      'share.clipboard': '{price} = 私の人生の{time}。それだけの価値ある？',
    },

    'zh-CN': {
      'format.decimal': '.',

      'nav.settings': '设置',
      'nav.settingsTitle': '设置',
      'price.label': '价格',
      'price.currencyLabel': '此价格的货币',

      'result.ofYourLife': '的人生',
      'result.copy': '复制',
      'result.copied': '已复制',
      'result.copyFailed': '复制失败',
      'result.overflowDays': '+{days}天',

      'history.title': '历史记录',
      'history.empty': '还没有查询记录。',
      'history.clear': '清除历史记录',
      'history.total': '共 {time}',

      'site.title': '当前网站',
      'site.disable': '在此网站上停用',
      'site.forceCurrency': '为此网站指定货币',
      'site.autoDetect': '自动检测',

      'rates.attribution': '汇率来源：ExchangeRate-API',
      'rates.refresh': '刷新',
      'rates.none': '暂无汇率',
      'rates.updated': '汇率更新于 {date} · {source}',
      'rates.unknownDate': '未知',
      'rates.unknownDateLong': '未知日期',
      'rates.sourceSnapshot': '内置快照',
      'rates.noRateFor': '暂无 {code} 的汇率。请尝试刷新，或选择其他货币。',
      'rates.noneYetShort': '暂无汇率',
      'rates.unavailable': '汇率不可用（{source}，{date}）',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun': '先问一件事：你的税后收入是多少？它只保存在这台设备上。',
      'settings.income': '收入',
      'settings.monthly': '按月，税后',
      'settings.monthlyLabel': '税后月收入',
      'settings.hourly': '按小时，税后',
      'settings.hourlyLabel': '税后时薪',
      'settings.hoursPerWeek': '每周工作小时数',
      'settings.homeCurrency': '本国货币',
      'settings.showBadges': '在网页价格旁显示标记',
      'settings.language': '语言',
      'settings.save': '保存',
      'settings.back': '返回',
      'settings.errorHourly': '请输入大于零的时薪。',
      'settings.errorMonthly': '请输入大于零的月收入，以及每周工作小时数。',

      'framing.coffeeBreak': '一杯咖啡的工夫',
      'framing.quickErrand': '跑个腿的工夫',
      'framing.halfWorkday': '半个工作日',
      'framing.wholeWorkday': '你一整个星期二',
      'framing.daysOfLife': '你人生中的 {days} 天',
      'framing.wholeWorkWeek': '你一整个工作周',
      'framing.workWeeks': '{weeks} 个工作周',

      'time.hoursMinutes': '{hours}小时{minutes}分钟',
      'time.hours': '{hours}小时',
      'time.minutes': '{minutes}分钟',

      'badge.hoursMinutes': '{hours}h{minutes}m',
      'badge.hours': '{hours}h',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}天',
      'badge.unknown': '?',
      'badge.workTime': '{time}的工作时间',
      'badge.noRate': '没有{what}的汇率，因此未换算。',
      'badge.thisCurrency': '这种货币',

      'share.clipboard': '{price} = 我人生中的 {time}。值得吗？',
    },

    // Traditional script, with the wording used in Taiwan.
    'zh-TW': {
      'format.decimal': '.',

      'nav.settings': '設定',
      'nav.settingsTitle': '設定',
      'price.label': '價格',
      'price.currencyLabel': '此價格的貨幣',

      'result.ofYourLife': '的人生',
      'result.copy': '複製',
      'result.copied': '已複製',
      'result.copyFailed': '複製失敗',
      'result.overflowDays': '+{days}天',

      'history.title': '歷史紀錄',
      'history.empty': '尚無查詢紀錄。',
      'history.clear': '清除歷史紀錄',
      'history.total': '共 {time}',

      'site.title': '目前網站',
      'site.disable': '在此網站停用',
      'site.forceCurrency': '為此網站指定貨幣',
      'site.autoDetect': '自動偵測',

      'rates.attribution': '匯率來源：ExchangeRate-API',
      'rates.refresh': '重新整理',
      'rates.none': '尚無匯率',
      'rates.updated': '匯率更新於 {date} · {source}',
      'rates.unknownDate': '未知',
      'rates.unknownDateLong': '未知日期',
      'rates.sourceSnapshot': '內建快照',
      'rates.noRateFor': '尚無 {code} 的匯率。請嘗試重新整理，或選擇其他貨幣。',
      'rates.noneYetShort': '尚無匯率',
      'rates.unavailable': '無法取得匯率（{source}，{date}）',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun': '先問一件事：你的稅後收入是多少？資料只會留在這台裝置上。',
      'settings.income': '收入',
      'settings.monthly': '每月，稅後',
      'settings.monthlyLabel': '稅後月收入',
      'settings.hourly': '每小時，稅後',
      'settings.hourlyLabel': '稅後時薪',
      'settings.hoursPerWeek': '每週工作時數',
      'settings.homeCurrency': '本國貨幣',
      'settings.showBadges': '在網頁價格旁顯示標記',
      'settings.language': '語言',
      'settings.save': '儲存',
      'settings.back': '返回',
      'settings.errorHourly': '請輸入大於零的時薪。',
      'settings.errorMonthly': '請輸入大於零的月收入，以及每週工作時數。',

      'framing.coffeeBreak': '一杯咖啡的時間',
      'framing.quickErrand': '跑個腿的時間',
      'framing.halfWorkday': '半個工作天',
      'framing.wholeWorkday': '你一整個星期二',
      'framing.daysOfLife': '你人生中的 {days} 天',
      'framing.wholeWorkWeek': '你一整個工作週',
      'framing.workWeeks': '{weeks} 個工作週',

      'time.hoursMinutes': '{hours}小時{minutes}分鐘',
      'time.hours': '{hours}小時',
      'time.minutes': '{minutes}分鐘',

      'badge.hoursMinutes': '{hours}h{minutes}m',
      'badge.hours': '{hours}h',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}天',
      'badge.unknown': '?',
      'badge.workTime': '{time}的工作時間',
      'badge.noRate': '沒有{what}的匯率，因此未換算。',
      'badge.thisCurrency': '這種貨幣',

      'share.clipboard': '{price} = 我人生中的 {time}。值得嗎？',
    },
  };

  const LANGUAGES = Object.keys(MESSAGES);

  let current = DEFAULT;

  /** True for a language this build actually carries. */
  function isSupported(language) {
    return typeof language === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, language);
  }

  // Chinese browser tags that mean the Traditional script: the script itself,
  // or a region that writes it. Every other Chinese tag gets Simplified.
  const TRADITIONAL_CHINESE = /^zh-(hant|tw|hk|mo)(-|$)/;

  /**
   * The language to start in: the stored setting if it is one we have, else the
   * browser's own language, else English.
   *
   * The browser tag matches exactly first ('zh-TW'), then by language alone:
   * 'sv-SE' is 'sv', and 'pt-PT' gets the Brazilian table, which is closer to
   * what that reader expects than English. Chinese goes by script, since 'zh'
   * alone is not a table this build has.
   */
  function resolve(stored, browserLanguage) {
    if (isSupported(stored)) return stored;
    if (typeof browserLanguage !== 'string') return DEFAULT;
    const tag = browserLanguage.replace(/_/g, '-').toLowerCase();
    const exact = LANGUAGES.find((code) => code.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split('-')[0];
    if (base === 'zh') return TRADITIONAL_CHINESE.test(tag) ? 'zh-TW' : 'zh-CN';
    const sameLanguage = LANGUAGES.find((code) => code.toLowerCase().split('-')[0] === base);
    return sameLanguage || DEFAULT;
  }

  function setLanguage(language) {
    current = isSupported(language) ? language : DEFAULT;
    return current;
  }

  function language() {
    return current;
  }

  /**
   * One string, with {placeholders} filled from vars.
   *
   * Falls back through English to the key itself. A key that has gone missing
   * shows up as 'framing.wholeWorkday' in the UI, which is ugly on purpose: it
   * is visible, it names what is wrong, and it is not a thrown exception in a
   * content script running on someone's shop.
   */
  function t(key, vars) {
    const table = MESSAGES[current] || MESSAGES[DEFAULT];
    let template = table[key];
    if (typeof template !== 'string') template = MESSAGES[DEFAULT][key];
    if (typeof template !== 'string') return String(key);
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      const value = vars[name];
      if (value === undefined || value === null) return match;
      return typeof value === 'number' ? formatNumber(value) : String(value);
    });
  }

  /**
   * A number written the way the current language writes it: '2.5' in English,
   * '2,5' in Swedish, German, Spanish, Portuguese and French. Takes a number, or
   * the string toFixed() or toPrecision() made of one. Only the decimal point
   * changes; no thousands separator is added, so a figure reads the same length
   * in every language.
   */
  function formatNumber(value) {
    const text = String(value);
    const table = MESSAGES[current] || MESSAGES[DEFAULT];
    const decimal = table['format.decimal'] || '.';
    return decimal === '.' ? text : text.replace('.', decimal);
  }

  /**
   * Renders what lib/calc.js returns: a { key, ...vars } object, or null when
   * there is nothing to say. Keeps the arithmetic and the wording apart.
   */
  function render(parts) {
    if (!parts || !parts.key) return '';
    return t(parts.key, parts);
  }

  /** '3 h 45 min', localised. */
  function formatHoursMinutes(totalHours) {
    return render(root.WorthItCalc.durationParts(totalHours));
  }

  /** The compact badge form, '3h45m' or '2.5d', localised. */
  function formatBadge(totalHours, hoursPerWeek) {
    return render(root.WorthItCalc.badgeParts(totalHours, hoursPerWeek));
  }

  /** The display name of a language, in that language. */
  function nameOf(code) {
    return NAMES[code] || code;
  }

  root.WorthItI18n = {
    DEFAULT: DEFAULT,
    LANGUAGES: LANGUAGES,
    MESSAGES: MESSAGES,
    isSupported: isSupported,
    resolve: resolve,
    setLanguage: setLanguage,
    language: language,
    t: t,
    render: render,
    formatHoursMinutes: formatHoursMinutes,
    formatBadge: formatBadge,
    formatNumber: formatNumber,
    nameOf: nameOf,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.WorthItI18n;
}
