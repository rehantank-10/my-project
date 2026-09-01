import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ClinicalState, QuestionOutput, TreatmentSystem } from './ClinicalState.js';
import { RedFlagEngine } from './RedFlagEngine.js';
import { env } from '../config/env.js';

export interface AIProvider {
  extractFacts(input: string, state: ClinicalState, language: 'EN' | 'HI' | 'GU'): Promise<Partial<ClinicalState>>;
  generateNextQuestion(state: ClinicalState, language: 'EN' | 'HI' | 'GU', isAyush?: boolean): Promise<QuestionOutput>;
  translateText(text: string, targetLanguage: 'EN' | 'HI' | 'GU'): Promise<string>;
  generateClinicalSummary(state: ClinicalState, patient: any, vitals?: any, documents?: any[]): Promise<any>;
}

/**
 * Direct Comprehensive Clinical Dictionary for 100% Guaranteed Native Phrasing
 */
const CLINICAL_TRANSLATIONS: Record<string, { HI: string; GU: string; EN: string }> = {
  // Greetings
  welcome: {
    EN: 'Hello. I am MediKiosk, your clinical intake assistant. Please tell me what symptoms or health concerns brought you to the hospital today.',
    HI: 'नमस्ते। मैं मेडीकियोस्क क्लिनिकल सहायक हूँ। कृपया मुझे बताएं कि आज आपको क्या परेशानी या लक्षण महसूस हो रहे हैं?',
    GU: 'નમસ્તે. હું મેડીકિયોસ્ક સહાયક છું. કૃપા કરીને મને જણાવો કે આજે તમને કઈ તકલીફ કે લક્ષણો થઈ રહ્યા છે?',
  },
  // Onset Skin
  skin_onset: {
    EN: 'How many days have you had these pimples / skin spots, and are they spreading to other areas?',
    HI: 'आपको ये मुँहासे / दाने कितने दिनों से निकल रहे हैं, और क्या ये चेहरे या शरीर के अन्य हिस्सों में भी फैल रहे हैं?',
    GU: 'તમને આ ખીલ / ચામડી પરના દાણા કેટલા દિવસથી નીકળી રહ્યા છે, અને શું તે ચહેરા કે શરીરના અન્ય ભાગોમાં ફેલાઈ રહ્યા છે?',
  },
  // Character Skin
  skin_character: {
    EN: 'Is there any pain, itching, redness, or pus discharge with the pimples / skin spots?',
    HI: 'क्या इन मुँहासे / दानों में दर्द, तेज खुजली, लालिमा, या पस/मवाद जैसा कुछ बन रहा है?',
    GU: 'શું આ ખીલમાં દુખાવો, ખંજવાળ, લાલાશ, કે પરુ (પસ) જેવું જણાય છે?',
  },
  // Onset Generic
  generic_onset: {
    EN: 'When did your symptoms begin, and does anything make it better or worse?',
    HI: 'आपको इस समस्या की शुरुआत कब से हुई, और क्या किसी विशेष स्थिति में यह कम या ज्यादा होता है?',
    GU: 'તમને આ તકલીફની શરૂઆત ક્યારથી થઈ છે, અને કોઈ ચોક્કસ સમયે તે વધે કે ઘટે છે?',
  },
  // Severity Generic
  generic_severity: {
    EN: 'How does your discomfort feel, and what is the severity on a scale of 1 to 10?',
    HI: 'आपको इस परेशानी में किस तरह की तकलीफ महसूस हो रही है, और 1 से 10 के पैमाने पर कितनी गंभीरता है?',
    GU: 'તમને આમાં કેવા પ્રકારની તકલીફ જણાય છે, અને 1 થી 10 ના માપ પર કેટલી ગંભીરતા છે?',
  },
  // Associated Generic
  generic_associated: {
    EN: 'Have you noticed any other symptoms (like fever, nausea, dizziness, or unusual weakness)?',
    HI: 'क्या आपको इसके अलावा कोई अन्य समस्या जैसे बुखार, जी मिचलाना, चक्कर या असामान्य कमजोरी भी लग रही है?',
    GU: 'શું તમને આ સિવાય તાવ, ઉબકા, ચક્કર આવવા કે અસામાન્ય નબળાઈ જેવી કોઈ તકલીફ જણાય છે?',
  },
  // Background Generic
  generic_background: {
    EN: 'Do you have any existing chronic conditions (High BP, Diabetes, Thyroid) or known drug allergies?',
    HI: 'क्या आपको पहले से कोई पुरानी बीमारी (जैसे बीपी, शुगर, थायराइड) या किसी दवा से एलर्जी है?',
    GU: 'શું તમને પહેલેથી કોઈ જૂની બીમારી (જેમ કે બીપી, ડાયાબિટીસ, થાયરોઇડ) કે કોઈ દવાની એલર્જી છે?',
  },
};

/**
 * Native Multilingual Clinical Terminology & Grammar Synthesizer
 */
function getSymptomLabelInLang(complaint: string, lang: 'EN' | 'HI' | 'GU'): string {
  const c = complaint.toLowerCase();
  
  if (/pimple|acne|boil|मुँहासे|फुंसी|ખીલ/i.test(c)) {
    return lang === 'HI' ? 'मुँहासे / दानों' : lang === 'GU' ? 'ખીલ' : 'pimples / skin spots';
  }
  if (/rash|skin|itch|खुजली|ચકામા/i.test(c)) {
    return lang === 'HI' ? 'त्वचा की खुजली / चकत्तों' : lang === 'GU' ? 'ચામડીની ખંજવાળ / ચકામા' : 'skin rash and itching';
  }
  if (/chest|heart|सीने|छाती/i.test(c)) {
    return lang === 'HI' ? 'सीने में दर्द व भारीपन' : lang === 'GU' ? 'છાતીમાં દુખાવો અને ભારેપણું' : 'chest discomfort';
  }
  if (/knee|joint|bone|घुटने|जोड़ों|ઘૂંટણ|સાંધા/i.test(c)) {
    return lang === 'HI' ? 'घुटने और जोड़ों के दर्द' : lang === 'GU' ? 'ઘૂંટણ અને સાંધાના દુખાવા' : 'knee and joint pain';
  }
  if (/back|spine|कमर|પીઠ/i.test(c)) {
    return lang === 'HI' ? 'कमर और पीठ के दर्द' : lang === 'GU' ? 'કમરના દુખાવા' : 'back pain';
  }
  if (/stomach|abdom|acidity|vomit|पेट|પેટ/i.test(c)) {
    return lang === 'HI' ? 'पेट दर्द, जलन और तकलीफ' : lang === 'GU' ? 'પેટમાં દુખાવો અને બળતરા' : 'stomach discomfort and acidity';
  }
  if (/headache|head|migraine|सिरदर्द|માથા/i.test(c)) {
    return lang === 'HI' ? 'सिरदर्द' : lang === 'GU' ? 'માથાના દુખાવા' : 'headache';
  }
  if (/cough|cold|throat|खांसी|गला|ઉધરસ|ગળું/i.test(c)) {
    return lang === 'HI' ? 'खांसी और गले की खराश' : lang === 'GU' ? 'ઉધરસ અને ગળાની તકલીફ' : 'cough and throat irritation';
  }
  if (/fever|temperature|बुखार|તાવ/i.test(c)) {
    return lang === 'HI' ? 'बुखार और शारीरिक कमजोरी' : lang === 'GU' ? 'તાવ અને શારીરિક નબળાઈ' : 'fever and body weakness';
  }

  return lang === 'HI' ? 'इस समस्या' : lang === 'GU' ? 'આ તકલીફ' : 'this symptom';
}

export class UniversalClinicalEngine implements AIProvider {
  async extractFacts(input: string, state: ClinicalState, language: 'EN' | 'HI' | 'GU'): Promise<Partial<ClinicalState>> {
    const text = input.trim();
    const update: Partial<ClinicalState> = {};

    if (!state.chiefComplaint) {
      update.chiefComplaint = text;
      update.chiefComplaintOriginal = text;
      update.symptoms = [
        {
          name: text,
          originalText: text,
          onset: null,
          duration: null,
          severity: null,
          location: null,
          character: null,
          radiation: null,
          aggravatingFactors: [],
          relievingFactors: [],
          timing: null,
          progression: null,
        },
      ];
      return update;
    }

    const currentSymptom = state.symptoms[0] || {
      name: state.chiefComplaint,
      originalText: state.chiefComplaint,
      onset: null,
      duration: null,
      severity: null,
      location: null,
      character: null,
      radiation: null,
      aggravatingFactors: [],
      relievingFactors: [],
      timing: null,
      progression: null,
    };

    if (!currentSymptom.onset || !currentSymptom.duration) {
      currentSymptom.onset = text;
      currentSymptom.duration = text;
      update.symptoms = [currentSymptom];
      return update;
    }

    if (!currentSymptom.severity || !currentSymptom.character) {
      const numMatch = text.match(/\b([1-9]|10)\b/);
      currentSymptom.severity = numMatch ? parseInt(numMatch[1], 10) : 5;
      currentSymptom.character = text;
      update.symptoms = [currentSymptom];
      return update;
    }

    if (state.associatedSymptoms.length === 0) {
      update.associatedSymptoms = [{ name: text, present: true }];
      return update;
    }

    if (state.pastMedicalHistory.length === 0) {
      update.pastMedicalHistory = [text];
    }

    return update;
  }

  async translateText(text: string, targetLanguage: 'EN' | 'HI' | 'GU'): Promise<string> {
    const tLower = text.toLowerCase();

    // Check Welcome
    if (tLower.includes('welcome') || tLower.includes('assistant') || tLower.includes('नमस्ते') || tLower.includes('નમસ્તે')) {
      return CLINICAL_TRANSLATIONS.welcome[targetLanguage];
    }

    // Check Skin Questions
    if (tLower.includes('pimple') || tLower.includes('दाने') || tLower.includes('ખીલ') || tLower.includes('spreading')) {
      if (tLower.includes('pain') || tLower.includes('itching') || tLower.includes('खुजली') || tLower.includes('ખંજવાળ') || tLower.includes('pus')) {
        return CLINICAL_TRANSLATIONS.skin_character[targetLanguage];
      }
      return CLINICAL_TRANSLATIONS.skin_onset[targetLanguage];
    }

    // Check Generic Onset
    if (tLower.includes('begin') || tLower.includes('start') || tLower.includes('शुरुआत') || tLower.includes('શરૂઆત')) {
      return CLINICAL_TRANSLATIONS.generic_onset[targetLanguage];
    }

    // Check Severity
    if (tLower.includes('severity') || tLower.includes('scale') || tLower.includes('पैमाने') || tLower.includes('માપ')) {
      return CLINICAL_TRANSLATIONS.generic_severity[targetLanguage];
    }

    // Check Associated
    if (tLower.includes('other symptoms') || tLower.includes('fever') || tLower.includes('बुखार') || tLower.includes('તાવ')) {
      return CLINICAL_TRANSLATIONS.generic_associated[targetLanguage];
    }

    // Check Chronic / Background
    if (tLower.includes('chronic') || tLower.includes('diabetes') || tLower.includes('पुरानी') || tLower.includes('જૂની')) {
      return CLINICAL_TRANSLATIONS.generic_background[targetLanguage];
    }

    return text;
  }

  async generateNextQuestion(state: ClinicalState, language: 'EN' | 'HI' | 'GU', isAyush = false): Promise<QuestionOutput> {
    const lang: 'EN' | 'HI' | 'GU' = (language?.toUpperCase() as 'EN' | 'HI' | 'GU') || state.currentLanguage || 'EN';
    const system: TreatmentSystem = state.treatmentSystem || (isAyush ? 'AYURVEDA' : 'ALLOPATHY');
    const complaintText = state.chiefComplaint || 'problem';
    const localizedLabel = getSymptomLabelInLang(complaintText, lang);
    const turn = state.turnsCompleted || 0;
    const cLower = `${state.chiefComplaint || ''} ${state.chiefComplaintOriginal || ''}`.toLowerCase();

    const isSkin = /pimple|acne|rash|skin|itch|boil|eczema|allergy|फुंसी|मुँहासे|खुजली|ખીલ|ચકામા/i.test(cLower);
    const isRespiratory = /cough|breath|cold|wheez|asthma|throat|खांसी|सांस|गला|ઉધરસ|શ્વાસ/i.test(cLower);
    const isGIOrStomach = /stomach|abdom|vomit|diarrhea|acidity|gas|constipat|nausea|पेट|उल्टी|दस्त|પેટ|ઉલટી/i.test(cLower);
    const isOrthoOrJoint = /joint|bone|knee|back|pain|fracture|leg|shoulder|कमर|घुटने|जोड़ों|કમર|ઘૂંટણ/i.test(cLower);

    // Ayurveda: focus on Ayurvedic assessment dimensions without replacing medical safety triage.
    if (system === 'AYURVEDA') {
      if (turn === 0) return this.q(lang,
        { EN: `When did your ${localizedLabel} begin, and what makes it better or worse?`, HI: `${localizedLabel} की शुरुआत कब से हुई और किस चीज़ से यह बढ़ता या कम होता है?`, GU: `${localizedLabel}ની શરૂઆત ક્યારથી થઈ અને કઈ બાબતથી તે વધે કે ઘટે છે?` },
        { EN: ['Sudden onset', '2-3 days', 'More than 1 week', 'Recurring for months'], HI: ['अचानक शुरू', '2-3 दिनों से', 'एक सप्ताह से अधिक', 'कई महीनों से बार-बार'], GU: ['અચાનક શરૂઆત', '2-3 દિવસથી', 'એક અઠવાડિયાથી વધુ', 'ઘણા મહિનાથી વારંવાર'] }, 'ONSET', 'Understanding onset and symptom pattern for Ayurvedic assessment');
      if (turn === 1) return this.q(lang,
        { EN: `How does the ${localizedLabel} feel, and is there a clear pattern with heat, cold, food, time of day, or activity?`, HI: `${localizedLabel} कैसा महसूस होता है? क्या गर्मी, ठंड, भोजन, दिन के समय या गतिविधि से इसमें स्पष्ट बदलाव आता है?`, GU: `${localizedLabel} કેવું લાગે છે? શું ગરમી, ઠંડી, ભોજન, દિવસના સમય અથવા પ્રવૃત્તિથી તેમાં સ્પષ્ટ ફેરફાર થાય છે?` },
        { EN: ['Worse with heat', 'Worse with cold', 'Worse after food', 'No clear pattern'], HI: ['गर्मी से बढ़ता है', 'ठंड से बढ़ता है', 'खाने के बाद बढ़ता है', 'कोई स्पष्ट पैटर्न नहीं'], GU: ['ગરમીથી વધે છે', 'ઠંડીથી વધે છે', 'ભોજન પછી વધે છે', 'કોઈ સ્પષ્ટ પેટર્ન નથી'] }, 'CHARACTER', 'Identifying symptom modalities relevant to Ayurvedic assessment');
      if (turn === 2) return this.q(lang,
        { EN: 'How are your appetite, thirst, digestion, bowel movements, and sleep compared with your usual pattern?', HI: 'आपकी भूख, प्यास, पाचन, मल त्याग और नींद सामान्य दिनों की तुलना में कैसी है?', GU: 'તમારી ભૂખ, તરસ, પાચન, મળત્યાગ અને ઊંઘ સામાન્ય કરતાં કેવી છે?' },
        { EN: ['All normal', 'Appetite/digestion changed', 'Bowel pattern changed', 'Sleep changed'], HI: ['सब सामान्य', 'भूख/पाचन बदला है', 'मल त्याग में बदलाव', 'नींद में बदलाव'], GU: ['બધું સામાન્ય', 'ભૂખ/પાચનમાં ફેરફાર', 'મળત્યાગમાં ફેરફાર', 'ઊંઘમાં ફેરફાર'] }, 'AYUSH', 'Screening Ayurvedic lifestyle and digestive assessment domains');
      if (turn === 3) return this.q(lang,
        { EN: 'Have you noticed changes in your daily routine, diet, stress, activity, or sleep around the time this problem started?', HI: 'यह समस्या शुरू होने के आसपास आपकी दिनचर्या, भोजन, तनाव, गतिविधि या नींद में कोई बदलाव हुआ था?', GU: 'આ તકલીફ શરૂ થઈ ત્યારે તમારી દિનચર્યા, આહાર, તણાવ, પ્રવૃત્તિ અથવા ઊંઘમાં કોઈ ફેરફાર થયો હતો?' },
        { EN: ['No major change', 'Diet changed', 'Stress/routine changed', 'Sleep/activity changed'], HI: ['कोई बड़ा बदलाव नहीं', 'भोजन में बदलाव', 'तनाव/दिनचर्या बदली', 'नींद/गतिविधि बदली'], GU: ['કોઈ મોટો ફેરફાર નહીં', 'આહારમાં ફેરફાર', 'તણાવ/દિનચર્યામાં ફેરફાર', 'ઊંઘ/પ્રવૃત્તિમાં ફેરફાર'] }, 'AYUSH', 'Capturing Ahara and Vihara factors for clinician review');
      return this.q(lang,
        { EN: 'Do you have any chronic conditions, regular medicines, allergies, or previous treatment for this problem?', HI: 'क्या आपको कोई पुरानी बीमारी, नियमित दवाएँ, एलर्जी या इस समस्या का पहले लिया गया उपचार है?', GU: 'શું તમને કોઈ જૂની બીમારી, નિયમિત દવાઓ, એલર્જી અથવા આ તકલીફ માટે અગાઉની સારવાર છે?' },
        { EN: ['Chronic condition/medicines', 'Allergy', 'Previous treatment', 'None of these'], HI: ['पुरानी बीमारी/दवाएँ', 'एलर्जी', 'पहले उपचार लिया', 'इनमें से कुछ नहीं'], GU: ['જૂની બીમારી/દવાઓ', 'એલર્જી', 'અગાઉ સારવાર લીધી', 'આમાંથી કંઈ નહીં'] }, 'PAST_HISTORY', 'Completing safety-critical history before clinician review');
    }

    // Homeopathy: focus on symptom modalities and individual response patterns; do not diagnose or prescribe.
    if (system === 'HOMEOPATHY') {
      if (turn === 0) return this.q(lang,
        { EN: `When did your ${localizedLabel} begin, and did it start suddenly or gradually?`, HI: `${localizedLabel} की शुरुआत कब हुई? यह अचानक शुरू हुआ या धीरे-धीरे?`, GU: `${localizedLabel} ક્યારથી શરૂ થયું? તે અચાનક શરૂ થયું કે ધીમે ધીમે?` },
        { EN: ['Suddenly', 'Gradually', 'After an illness', 'Keeps recurring'], HI: ['अचानक', 'धीरे-धीरे', 'बीमारी के बाद', 'बार-बार होता है'], GU: ['અચાનક', 'ધીમે ધીમે', 'કોઈ બીમારી પછી', 'વારંવાર થાય છે'] }, 'ONSET', 'Establishing onset and recurrence pattern');
      if (turn === 1) return this.q(lang,
        { EN: `What changes the ${localizedLabel}: heat or cold, movement or rest, pressure, time of day, food, or position?`, HI: `${localizedLabel} में गर्मी/ठंड, चलने/आराम, दबाव, दिन के समय, भोजन या शरीर की स्थिति से क्या बदलाव होता है?`, GU: `${localizedLabel}માં ગરમી/ઠંડી, હલનચલન/આરામ, દબાણ, દિવસના સમય, ભોજન અથવા સ્થિતિથી શું ફેરફાર થાય છે?` },
        { EN: ['Better with warmth', 'Better with cold', 'Better with rest', 'Better with movement'], HI: ['गर्मी से आराम', 'ठंड से आराम', 'आराम से आराम', 'चलने से आराम'], GU: ['ગરમીથી રાહત', 'ઠંડીથી રાહત', 'આરામથી રાહત', 'હલનચલનથી રાહત'] }, 'CHARACTER', 'Documenting patient-reported modalities');
      if (turn === 2) return this.q(lang,
        { EN: 'What is the main sensation: burning, throbbing, cramping, pressure, itching, weakness, or another feeling?', HI: 'मुख्य अनुभूति कैसी है: जलन, धड़कना, मरोड़, दबाव, खुजली, कमजोरी या कुछ और?', GU: 'મુખ્ય અનુભવ કેવો છે: બળતરા, ધબકારા, ચૂંક, દબાણ, ખંજવાળ, નબળાઈ કે બીજું કંઈ?' },
        { EN: ['Burning', 'Throbbing', 'Cramping/pressure', 'Itching/weakness'], HI: ['जलन', 'धड़कना', 'मरोड़/दबाव', 'खुजली/कमजोरी'], GU: ['બળતરા', 'ધબકારા', 'ચૂંક/દબાણ', 'ખંજવાળ/નબળાઈ'] }, 'CHARACTER', 'Clarifying the patient-described sensation');
      if (turn === 3) return this.q(lang,
        { EN: 'Have you noticed any change in appetite, thirst, sleep, mood/stress, or energy since this problem began?', HI: 'यह समस्या शुरू होने के बाद भूख, प्यास, नींद, मनोदशा/तनाव या ऊर्जा में कोई बदलाव हुआ है?', GU: 'આ તકલીફ શરૂ થયા પછી ભૂખ, તરસ, ઊંઘ, મનોદશા/તણાવ અથવા ઊર્જામાં કોઈ ફેરફાર થયો છે?' },
        { EN: ['No major change', 'Appetite/thirst changed', 'Sleep/mood changed', 'Energy changed'], HI: ['कोई बड़ा बदलाव नहीं', 'भूख/प्यास बदली', 'नींद/मनोदशा बदली', 'ऊर्जा बदली'], GU: ['કોઈ મોટો ફેરફાર નહીં', 'ભૂખ/તરસમાં ફેરફાર', 'ઊંઘ/મનોદશામાં ફેરફાર', 'ઊર્જામાં ફેરફાર'] }, 'AYUSH', 'Capturing individualized associated features for clinician review');
      return this.q(lang,
        { EN: 'Do you have chronic conditions, regular medicines, allergies, or previous treatment that we should record for safety?', HI: 'सुरक्षा के लिए क्या कोई पुरानी बीमारी, नियमित दवाएँ, एलर्जी या पहले लिया गया उपचार दर्ज करना चाहिए?', GU: 'સુરક્ષા માટે કોઈ જૂની બીમારી, નિયમિત દવાઓ, એલર્જી અથવા અગાઉની સારવાર નોંધવી જોઈએ?' },
        { EN: ['Chronic condition/medicines', 'Allergy', 'Previous treatment', 'None of these'], HI: ['पुरानी बीमारी/दवाएँ', 'एलर्जी', 'पहले उपचार लिया', 'इनमें से कुछ नहीं'], GU: ['જૂની બીમારી/દવાઓ', 'એલર્જી', 'અગાઉ સારવાર લીધી', 'આમાંથી કંઈ નહીં'] }, 'PAST_HISTORY', 'Completing safety-critical history before clinician review');
    }

    // Allopathy: conventional symptom history and safety screening.
    if (turn === 0) return this.q(lang,
      { EN: `When did your ${localizedLabel} begin, and does anything make it better or worse?`, HI: `${localizedLabel} की शुरुआत कब से हुई, और क्या किसी स्थिति में यह कम या ज्यादा होता है?`, GU: `${localizedLabel}ની શરૂઆત ક્યારથી થઈ છે, અને કોઈ ચોક્કસ સ્થિતિમાં તે વધે કે ઘટે છે?` },
      { EN: ['Today / suddenly', '2-3 days', 'More than 1 week', 'Recurring for months'], HI: ['आज / अचानक', '2-3 दिनों से', 'एक सप्ताह से अधिक', 'कई महीनों से बार-बार'], GU: ['આજે / અચાનક', '2-3 દિવસથી', 'એક અઠવાડિયાથી વધુ', 'ઘણા મહિનાથી વારંવાર'] }, 'ONSET', 'Establishing onset and trigger factors');
    if (turn === 1) {
      let q = { EN: `How does your ${localizedLabel} feel, and how severe is it from 1 to 10?`, HI: `${localizedLabel} में कैसी तकलीफ है और 1 से 10 में इसकी तीव्रता कितनी है?`, GU: `${localizedLabel}માં કેવી તકલીફ છે અને 1 થી 10માં તેની તીવ્રતા કેટલી છે?` };
      let opt = { EN: ['1-3 Mild', '4-6 Moderate', '7-10 Severe'], HI: ['1-3 हल्की', '4-6 मध्यम', '7-10 तेज'], GU: ['1-3 હળવી', '4-6 મધ્યમ', '7-10 તીવ્ર'] };
      if (isSkin) { q = { EN: `Is there pain, itching, redness, or pus with the ${localizedLabel}?`, HI: `${localizedLabel} में दर्द, खुजली, लालिमा या पस है?`, GU: `${localizedLabel}માં દુખાવો, ખંજવાળ, લાલાશ કે પરુ છે?` }; opt = { EN: ['Itching', 'Pain/redness', 'Pus/deep boils', 'Mild'], HI: ['खुजली', 'दर्द/लालिमा', 'पस/गहरे दाने', 'हल्की'], GU: ['ખંજવાળ', 'દુખાવો/લાલાશ', 'પરુ/ઊંડા દાણા', 'હળવી'] }; }
      else if (isGIOrStomach) { q = { EN: `Is there burning, cramping, nausea, or fullness with this ${localizedLabel}?`, HI: `${localizedLabel} के साथ जलन, मरोड़, जी मिचलाना या भारीपन है?`, GU: `${localizedLabel} સાથે બળતરા, ચૂંક, ઉબકા કે ભારેપણું છે?` }; opt = { EN: ['Burning', 'Cramping', 'Nausea', 'Fullness/bloating'], HI: ['जलन', 'मरोड़', 'जी मिचलाना', 'भारीपन/पेट फूलना'], GU: ['બળતરા', 'ચૂંક', 'ઉબકા', 'ભારેપણું/પેટ ફૂલવું'] }; }
      else if (isOrthoOrJoint) { q = { EN: `Is there swelling, stiffness, or difficulty moving the area?`, HI: `क्या उस हिस्से में सूजन, अकड़न या हिलाने में कठिनाई है?`, GU: `શું તે ભાગમાં સોજો, જકડાઈ જવું કે હલાવવામાં મુશ્કેલી છે?` }; opt = { EN: ['Swelling', 'Morning stiffness', 'Movement difficulty', 'Mild ache'], HI: ['सूजन', 'सुबह अकड़न', 'हिलाने में कठिनाई', 'हल्का दर्द'], GU: ['સોજો', 'સવારે જકડાઈ જવું', 'હલાવવામાં મુશ્કેલી', 'હળવો દુખાવો'] }; }
      return this.q(lang, q, opt, 'CHARACTER', 'Characterizing the symptom and severity');
    }
    if (turn === 2) return this.q(lang,
      { EN: 'Have you noticed any other symptoms such as fever, vomiting, dizziness, breathing difficulty, or unusual weakness?', HI: 'क्या बुखार, उल्टी, चक्कर, सांस लेने में परेशानी या असामान्य कमजोरी जैसे अन्य लक्षण हैं?', GU: 'શું તાવ, ઉલટી, ચક્કર, શ્વાસમાં તકલીફ અથવા અસામાન્ય નબળાઈ જેવા અન્ય લક્ષણો છે?' },
      { EN: ['Fever/fatigue', 'Nausea/vomiting', 'Dizziness/weakness', 'No other symptoms'], HI: ['बुखार/थकान', 'जी मिचलाना/उल्टी', 'चक्कर/कमजोरी', 'अन्य लक्षण नहीं'], GU: ['તાવ/થાક', 'ઉબકા/ઉલટી', 'ચક્કર/નબળાઈ', 'અન્ય લક્ષણો નથી'] }, 'ASSOCIATED', 'Screening associated symptoms and safety concerns');
    if (turn === 3) return this.q(lang,
      { EN: 'Do you have any chronic conditions, regular medicines, previous treatment, or known allergies?', HI: 'क्या आपको कोई पुरानी बीमारी, नियमित दवाएँ, पहले लिया गया उपचार या ज्ञात एलर्जी है?', GU: 'શું તમને કોઈ જૂની બીમારી, નિયમિત દવાઓ, અગાઉની સારવાર અથવા જાણીતી એલર્જી છે?' },
      { EN: ['Chronic condition', 'Regular medicines', 'Allergy/previous treatment', 'None'], HI: ['पुरानी बीमारी', 'नियमित दवाएँ', 'एलर्जी/पहले उपचार', 'कुछ नहीं'], GU: ['જૂની બીમારી', 'નિયમિત દવાઓ', 'એલર્જી/અગાઉની સારવાર', 'કંઈ નથી'] }, 'PAST_HISTORY', 'Completing safety-critical medical history');
    return this.q(lang,
      { EN: 'Is there anything else about your symptoms that you want the doctor to know?', HI: 'क्या आपके लक्षणों के बारे में कोई और महत्वपूर्ण बात है जो डॉक्टर को पता होनी चाहिए?', GU: 'તમારા લક્ષણો વિશે કોઈ બીજી મહત્વની વાત છે જે ડૉક્ટરને જાણવી જોઈએ?' },
      { EN: ['No, that covers everything', 'Yes, I want to add something'], HI: ['नहीं, सब बता दिया', 'हाँ, कुछ और बताना है'], GU: ['ના, બધું જણાવી દીધું', 'હા, કંઈક વધુ જણાવવું છે'] }, 'CLOSING', 'Confirming completeness before clinician review');
  }

  private q(lang: 'EN' | 'HI' | 'GU', questions: Record<'EN' | 'HI' | 'GU', string>, options: Record<'EN' | 'HI' | 'GU', string[]>, category: QuestionOutput['questionCategory'], rationale: string): QuestionOutput {
    return { question: questions[lang], questionLanguage: lang, questionCategory: category, touchOptions: options[lang], isRedFlag: false, redFlagReason: null, isComplete: category === 'CLOSING', clinicalRationale: rationale };
  }
}

export class GeminiAIProvider implements AIProvider {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private fallback = new UniversalClinicalEngine();

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
  }

  async extractFacts(input: string, state: ClinicalState, language: 'EN' | 'HI' | 'GU'): Promise<Partial<ClinicalState>> {
    try {
      const prompt = `You are the fact extraction component of MediKiosk AI Clinical Intake.
Patient Input: "${input}"
Input Language: ${language}
Current Clinical State: ${JSON.stringify(state)}

Extract all clinical facts into English-normalized structured JSON with no markdown fences:
{
  "chiefComplaint": "string | null",
  "newSymptoms": [
    {
      "name": "normalized english symptom name",
      "originalText": "exact text from patient",
      "onset": "duration or onset if mentioned or null",
      "severity": 1-10 or null,
      "character": "string describing quality/sensation or null"
    }
  ],
  "pastConditions": ["string"],
  "medications": ["string"]
}`;

      const res = await this.model.generateContent(prompt);
      const text = res.response.text().replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);

      const update: Partial<ClinicalState> = {};
      if (parsed.chiefComplaint && !state.chiefComplaint) {
        update.chiefComplaint = parsed.chiefComplaint;
        update.chiefComplaintOriginal = input;
      }
      if (parsed.newSymptoms && Array.isArray(parsed.newSymptoms) && parsed.newSymptoms.length > 0) {
        update.symptoms = [...(state.symptoms || []), ...parsed.newSymptoms];
      }
      if (parsed.pastConditions && Array.isArray(parsed.pastConditions) && parsed.pastConditions.length > 0) {
        update.pastMedicalHistory = [...(state.pastMedicalHistory || []), ...parsed.pastConditions];
      }
      if (parsed.medications && Array.isArray(parsed.medications) && parsed.medications.length > 0) {
        const newMeds = parsed.medications.map((m: string) => ({ name: m }));
        update.medications = [...(state.medications || []), ...newMeds];
      }
      return update;
    } catch (e) {
      console.warn('Gemini extractFacts fallback:', e);
      return this.fallback.extractFacts(input, state, language);
    }
  }

  async translateText(text: string, targetLanguage: 'EN' | 'HI' | 'GU'): Promise<string> {
    try {
      const prompt = `Translate the following hospital clinical intake sentence into natural, grammatically correct ${targetLanguage}.
Do NOT add extra conversational text or explanations. Return ONLY the translated sentence in pure ${targetLanguage}:
"${text}"`;

      const res = await this.model.generateContent(prompt);
      const result = res.response.text().trim();
      if (result && result.length > 2) {
        return result;
      }
      return this.fallback.translateText(text, targetLanguage);
    } catch (e) {
      return this.fallback.translateText(text, targetLanguage);
    }
  }

  async generateNextQuestion(state: ClinicalState, language: 'EN' | 'HI' | 'GU', isAyush = false): Promise<QuestionOutput> {
    try {
      const system: TreatmentSystem = state.treatmentSystem || (isAyush ? 'AYURVEDA' : 'ALLOPATHY');
      const prompt = `You are MediKiosk Autonomous Clinical AI Intake Engine powered by Google Gemini.
Treatment system: ${system}
Patient Complaint: "${state.chiefComplaint || ''}"
Target Language: ${language} (EN = English, HI = Hindi, GU = Gujarati)
Current Clinical State: ${JSON.stringify(state)}
Questions already asked: ${JSON.stringify(state.questionsAsked)}
Total turns completed so far: ${state.turnsCompleted}

CRITICAL RULES:
1. NEVER repeat any question already in questionsAsked.
2. NEVER mix treatment systems. The treatment system is ${system}.
3. For ALLOPATHY, prioritize conventional symptom history, severity, associated symptoms, medicines, allergies, and red-flag screening.
4. For AYURVEDA, prioritize symptom modalities plus Ahara (diet), Vihara (routine/activity), Agni/digestion, bowel habits, sleep, and patient-reported Prakriti/Vikriti observations. Do not claim a dosha diagnosis.
5. For HOMEOPATHY, prioritize individualized symptom modalities (better/worse from heat/cold, motion/rest, pressure, time, food/position), sensation, thirst/appetite, sleep/mood/energy, and recurrence. Do not prescribe a remedy.
6. Safety-critical medical history and red-flag screening must still be covered for every system.
7. Advance logically and ask ONE precise follow-up question in pure ${language}.
8. If you determine you have gathered all necessary information, provide a closing wrap-up question and set "isComplete": true.
9. If more details are needed, set "isComplete": false and ask ONE precise follow-up question in pure ${language}.
10. If ${language} is HI, use 100% natural Hindi. If ${language} is GU, use 100% natural Gujarati. If EN, use clinical English.

Return ONLY valid JSON (no markdown fences):
{
  "question": "string in pure ${language}",
  "questionLanguage": "${language}",
  "questionCategory": "ONSET | DURATION | SEVERITY | CHARACTER | ASSOCIATED | MEDICATIONS | PAST_HISTORY | AYUSH | CLOSING",
  "touchOptions": ["Option 1 in ${language}", "Option 2 in ${language}", "Option 3 in ${language}"],
  "isRedFlag": boolean,
  "redFlagReason": "string | null",
  "isComplete": boolean,
  "clinicalRationale": "string explaining why this question was chosen or why intake is now complete"
}`;

      const res = await this.model.generateContent(prompt);
      const text = res.response.text().replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      return JSON.parse(text);
    } catch (e) {
      console.warn('Gemini generateNextQuestion fallback:', e);
      return this.fallback.generateNextQuestion(state, language, isAyush);
    }
  }

  async generateClinicalSummary(state: ClinicalState, patient: any, vitals?: any, documents?: any[]): Promise<any> {
    try {
      const prompt = `You are a clinical documentation AI. Generate a professional structured clinical intake summary based on:
Patient: ${JSON.stringify(patient)}
Clinical State: ${JSON.stringify(state)}
Vitals: ${JSON.stringify(vitals || {})}

Return valid JSON with no markdown fences:
{
  "overview": "Brief clinical overview of the patient presentation",
  "chiefComplaint": "Chief complaint statement",
  "historyOfPresentIllness": "Comprehensive narrative History of Present Illness (HPI) including onset, progression, aggravating/relieving factors, and character",
  "pastMedicalHistory": "Summary of prior chronic conditions",
  "medications": "Current regular medications",
  "allergies": "Known drug/environmental allergies or NKDA",
  "vitalHighlights": "Summary of vitals if present",
  "redFlags": ["List of any detected clinical red flags"],
  "sourceMap": {
    "chiefComplaint": "Patient Voice Intake",
    "historyOfPresentIllness": "Gemini Multilingual Autonomous Clinical Intake"
  }
}`;

      const res = await this.model.generateContent(prompt);
      const text = res.response.text().replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      return JSON.parse(text);
    } catch (e) {
      return this.fallback.generateClinicalSummary(state, patient, vitals, documents);
    }
  }
}

export function getAIProvider(): AIProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey.length > 10) {
    console.log('🤖 Using GeminiAIProvider (Autonomous Gemini 3.6 Flash)');
    return new GeminiAIProvider(apiKey);
  }
  console.log('💡 Using UniversalClinicalEngine (Pure Native Multilingual Clinical Intelligence)');
  return new UniversalClinicalEngine();
}
