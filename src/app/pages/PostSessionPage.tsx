import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBanner } from '@app/components/StatusBanner';
import { useAppStore } from '@app/state/useAppStore';
import type { PostSessionFormValues } from '@ipc/schemas';

const POST_SYMPTOM_RATINGS: Array<{ key: keyof PostSessionFormValues; label: string }> = [
  { key: 'postSymptomDryness', label: 'Eye dryness right now (0-5)' },
  { key: 'postSymptomTiredness', label: 'Eye tiredness right now (0-5)' },
  { key: 'postSymptomBurningStinging', label: 'Burning or stinging right now (0-5)' },
  { key: 'postSymptomBlurryVision', label: 'Blurry vision right now (0-5)' },
  { key: 'postSymptomLightSensitivity', label: 'Light sensitivity right now (0-5)' }
];

const COMFORT_RATINGS: Array<{ key: keyof PostSessionFormValues; label: string }> = [
  { key: 'readingEyeComfort', label: 'Eye comfort during reading overall (1-5)' },
  { key: 'concentrationEase', label: 'Ease concentrating on reading material (1-5)' },
  { key: 'mentalFatigueEnd', label: 'Mental fatigue by end of session (1-5)' },
  { key: 'physicalFatigueEnd', label: 'Physical tiredness by end of session (1-5)' },
  { key: 'screenBrightnessComfort', label: 'Screen brightness or print comfort (1-5)' },
  { key: 'roomLightingComfort', label: 'Room lighting comfort (1-5)' },
  { key: 'fontSizeComfort', label: 'Font size comfort (1-5)' },
  { key: 'viewingDistanceComfort', label: 'Viewing distance comfort (1-5)' },
  { key: 'roomTemperatureComfort', label: 'Room temperature comfort (1-5)' }
];

const postSessionMetadata = (values: PostSessionFormValues) => ({
  session_context: values.postSessionContext || 'reading',
  ocular_symptoms: {
    dryness_0_to_5: values.postSymptomDryness,
    tiredness_0_to_5: values.postSymptomTiredness,
    burning_stinging_0_to_5: values.postSymptomBurningStinging,
    blurry_vision_0_to_5: values.postSymptomBlurryVision,
    light_sensitivity_0_to_5: values.postSymptomLightSensitivity,
    symptoms_during_reading: values.symptomsDuringReading,
    symptoms_during_reading_timing: values.symptomsDuringReadingTiming
  },
  comfort_during_reading: {
    eye_comfort_1_to_5: values.readingEyeComfort,
    discomfort_increased: values.discomfortIncreased,
    urge_rub_eyes: values.urgeRubEyes,
    urge_look_away: values.urgeLookAway,
    urge_blink_more: values.urgeBlinkMore,
    pressure_or_heaviness: values.eyePressureHeaviness
  },
  vision: {
    clear_throughout: values.visionClearThroughout,
    text_harder_to_focus: values.textHarderToFocus,
    text_harder_to_focus_timing: values.textHarderToFocusTiming,
    headache_during_or_after: values.headacheDuringAfter
  },
  reading_experience: {
    concentration_ease_1_to_5: values.concentrationEase,
    mental_fatigue_end_1_to_5: values.mentalFatigueEnd,
    physical_fatigue_end_1_to_5: values.physicalFatigueEnd,
    distracted_during_session: values.distractedDuringSession,
    distraction_details: values.distractionDetails
  },
  device_environment: {
    screen_brightness_or_print_comfort_1_to_5: values.screenBrightnessComfort,
    room_lighting_comfort_1_to_5: values.roomLightingComfort,
    font_size_comfort_1_to_5: values.fontSizeComfort,
    viewing_distance_comfort_1_to_5: values.viewingDistanceComfort,
    room_temperature_comfort_1_to_5: values.roomTemperatureComfort
  },
  baseline_kaleidoscope_experience: {
    video_comfort_1_to_5: values.baselineVideoComfort,
    eye_strain: values.baselineVideoEyeStrain,
    motion_discomfort: values.baselineVideoMotionDiscomfort,
    notes: values.baselineVideoNotes
  }
});

export const PostSessionPage = (): JSX.Element => {
  const form = useAppStore((state) => state.postSessionForm);
  const setFormValue = useAppStore((state) => state.setPostSessionFormValue);
  const setPostSessionForm = useAppStore((state) => state.setPostSessionForm);
  const resetPostSessionForm = useAppStore((state) => state.resetPostSessionForm);
  const analysisSession = useAppStore((state) => state.analysisSession);
  const lastCreatedSession = useAppStore((state) => state.lastCreatedSession);
  const setAnalysisSession = useAppStore((state) => state.setAnalysisSession);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const loadedPostSessionFolderRef = useRef<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const targetSessionFolder = analysisSession?.paths.sessionFolder ?? lastCreatedSession?.paths.sessionFolder ?? '';
  const targetSessionName = String(
    analysisSession?.metadata.session_name || lastCreatedSession?.metadata.session_name || 'No active session'
  );

  const isBaselinePostSession = form.postSessionContext === 'baseline';

  useEffect(() => {
    if (!targetSessionFolder || loadedPostSessionFolderRef.current === targetSessionFolder) {
      return;
    }
    loadedPostSessionFolderRef.current = targetSessionFolder;
    const saved = analysisSession?.metadata.post_session;
    if (saved && typeof saved === 'object') {
      const savedRecord = saved as Record<string, unknown>;
      const ocularSymptoms = (savedRecord.ocular_symptoms ?? {}) as Record<string, unknown>;
      const comfortDuringReading = (savedRecord.comfort_during_reading ?? {}) as Record<string, unknown>;
      const vision = (savedRecord.vision ?? {}) as Record<string, unknown>;
      const readingExperience = (savedRecord.reading_experience ?? {}) as Record<string, unknown>;
      const deviceEnvironment = (savedRecord.device_environment ?? {}) as Record<string, unknown>;
      const baselineExperience = (savedRecord.baseline_kaleidoscope_experience ?? {}) as Record<string, unknown>;
      setPostSessionForm({
        postSessionContext: String(savedRecord.session_context ?? 'reading'),
        postSymptomDryness: String(ocularSymptoms.dryness_0_to_5 ?? ''),
        postSymptomTiredness: String(ocularSymptoms.tiredness_0_to_5 ?? ''),
        postSymptomBurningStinging: String(ocularSymptoms.burning_stinging_0_to_5 ?? ''),
        postSymptomBlurryVision: String(ocularSymptoms.blurry_vision_0_to_5 ?? ''),
        postSymptomLightSensitivity: String(ocularSymptoms.light_sensitivity_0_to_5 ?? ''),
        symptomsDuringReading: String(ocularSymptoms.symptoms_during_reading ?? ''),
        symptomsDuringReadingTiming: String(ocularSymptoms.symptoms_during_reading_timing ?? ''),
        readingEyeComfort: String(comfortDuringReading.eye_comfort_1_to_5 ?? ''),
        discomfortIncreased: String(comfortDuringReading.discomfort_increased ?? ''),
        urgeRubEyes: String(comfortDuringReading.urge_rub_eyes ?? ''),
        urgeLookAway: String(comfortDuringReading.urge_look_away ?? ''),
        urgeBlinkMore: String(comfortDuringReading.urge_blink_more ?? ''),
        eyePressureHeaviness: String(comfortDuringReading.pressure_or_heaviness ?? ''),
        visionClearThroughout: String(vision.clear_throughout ?? ''),
        textHarderToFocus: String(vision.text_harder_to_focus ?? ''),
        textHarderToFocusTiming: String(vision.text_harder_to_focus_timing ?? ''),
        headacheDuringAfter: String(vision.headache_during_or_after ?? ''),
        concentrationEase: String(readingExperience.concentration_ease_1_to_5 ?? ''),
        mentalFatigueEnd: String(readingExperience.mental_fatigue_end_1_to_5 ?? ''),
        physicalFatigueEnd: String(readingExperience.physical_fatigue_end_1_to_5 ?? ''),
        distractedDuringSession: String(readingExperience.distracted_during_session ?? ''),
        distractionDetails: String(readingExperience.distraction_details ?? ''),
        screenBrightnessComfort: String(deviceEnvironment.screen_brightness_or_print_comfort_1_to_5 ?? ''),
        roomLightingComfort: String(deviceEnvironment.room_lighting_comfort_1_to_5 ?? ''),
        fontSizeComfort: String(deviceEnvironment.font_size_comfort_1_to_5 ?? ''),
        viewingDistanceComfort: String(deviceEnvironment.viewing_distance_comfort_1_to_5 ?? ''),
        roomTemperatureComfort: String(deviceEnvironment.room_temperature_comfort_1_to_5 ?? ''),
        baselineVideoComfort: String(baselineExperience.video_comfort_1_to_5 ?? ''),
        baselineVideoEyeStrain: String(baselineExperience.eye_strain ?? ''),
        baselineVideoMotionDiscomfort: String(baselineExperience.motion_discomfort ?? ''),
        baselineVideoNotes: String(baselineExperience.notes ?? '')
      });
    } else {
      resetPostSessionForm();
    }
  }, [analysisSession?.metadata.post_session, resetPostSessionForm, setPostSessionForm, targetSessionFolder]);

  const yesNoCheckbox = (key: keyof PostSessionFormValues, label: string) => {
    const setAnswer = (value: 'Yes' | 'No', checked: boolean) => {
      setFormValue(key, checked ? value : '');
    };

    return (
      <div className="yes-no-question">
        <span>{label}</span>
        <div className="yes-no-options">
          <label className="checkbox-row">
            <input
              checked={form[key] === 'Yes'}
              onChange={(event) => setAnswer('Yes', event.target.checked)}
              type="checkbox"
            />
            <span>Yes</span>
          </label>
          <label className="checkbox-row">
            <input
              checked={form[key] === 'No'}
              onChange={(event) => setAnswer('No', event.target.checked)}
              type="checkbox"
            />
            <span>No</span>
          </label>
        </div>
      </div>
    );
  };

  const ratingScale = (key: keyof PostSessionFormValues, label: string, min: number, max: number) => {
    const options = Array.from({ length: max - min + 1 }, (_, index) => String(min + index));
    return (
      <div className="rating-question">
        <span>{label}</span>
        <div className="rating-scale" role="group" aria-label={label}>
          {options.map((option) => (
            <button
              key={option}
              className={form[key] === option ? 'selected' : ''}
              onClick={() => setFormValue(key, form[key] === option ? '' : option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const symptomInputs = useMemo(
    () => POST_SYMPTOM_RATINGS.map((rating) => ratingScale(rating.key, rating.label, 0, 5)),
    [form]
  );

  const comfortInputs = useMemo(
    () => COMFORT_RATINGS.map((rating) => ratingScale(rating.key, rating.label, 1, 5)),
    [form]
  );

  const savePostSession = async () => {
    if (!targetSessionFolder || !window.electronAPI) {
      setError('Load or create a session before saving post-session information.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const metadata = await window.electronAPI.updateSessionMetadata({
        sessionFolder: targetSessionFolder,
        updates: {
          post_session: postSessionMetadata(form)
        }
      });
      if (analysisSession) {
        setAnalysisSession({
          ...analysisSession,
          metadata: { ...metadata }
        });
      }
      resetPostSessionForm();
      setSuccessMessage('Post-session information saved.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save post-session information.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="session-layout google-form-page">
      <div className="card session-form-card google-form-card">
        <div className="section-heading">
          <div>
            <h3>Post-Session Information</h3>
          </div>
          <p className="section-copy">
            Record symptoms and context after either the kaleidoscope baseline or the reading session.
          </p>
          <p className="field-helper">Current session: {targetSessionName}</p>
        </div>

        {error ? <StatusBanner tone="error" message={error} /> : null}
        {successMessage ? <StatusBanner tone="success" message={successMessage} /> : null}

        <div className="form-grid google-form-grid">
          <div className="form-section">
            <div className="section-heading compact">
              <div>
                <h3>Post-Session Type</h3>
              </div>
            </div>
            <div className="toggle-row">
              <button
                className={form.postSessionContext === 'baseline' ? 'selected' : ''}
                onClick={() => setFormValue('postSessionContext', 'baseline')}
                type="button"
              >
                Baseline / Kaleidoscope
              </button>
              <button
                className={form.postSessionContext !== 'baseline' ? 'selected' : ''}
                onClick={() => setFormValue('postSessionContext', 'reading')}
                type="button"
              >
                Reading Session
              </button>
            </div>
          </div>

          <div className="form-section">
            <div className="section-heading compact">
              <div>
                <h3>Ocular Symptoms</h3>
              </div>
              <p className="field-helper">0 = no signs of symptoms; 5 = extremely severe.</p>
            </div>
            <div className="compact-field-grid">{symptomInputs}</div>
            <div className="compact-field-grid">
              {yesNoCheckbox(
                'symptomsDuringReading',
                isBaselinePostSession
                  ? 'Experienced any of these symptoms during the kaleidoscope baseline'
                  : 'Experienced any of these symptoms during reading'
              )}
              {form.symptomsDuringReading === 'Yes' ? (
                <input
                  aria-label="When symptoms were first noticed"
                  value={form.symptomsDuringReadingTiming}
                  onChange={(event) => setFormValue('symptomsDuringReadingTiming', event.target.value)}
                  placeholder="When did you first notice?"
                />
              ) : null}
            </div>
          </div>

          {isBaselinePostSession ? (
            <div className="form-section">
              <div className="section-heading compact">
                <div>
                  <h3>Kaleidoscope Baseline Experience</h3>
                </div>
              </div>
              <div className="compact-field-grid">
                {ratingScale('baselineVideoComfort', 'Comfort watching the kaleidoscope video (1-5)', 1, 5)}
                {yesNoCheckbox('baselineVideoEyeStrain', 'Kaleidoscope video caused eye strain')}
                {yesNoCheckbox('baselineVideoMotionDiscomfort', 'Motion or colors felt uncomfortable')}
                <textarea
                  aria-label="Kaleidoscope baseline notes"
                  value={form.baselineVideoNotes}
                  onChange={(event) => setFormValue('baselineVideoNotes', event.target.value)}
                  rows={3}
                  placeholder="Notes about the kaleidoscope baseline"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="form-section">
                <div className="section-heading compact">
                  <div>
                    <h3>Comfort During Reading</h3>
                  </div>
                </div>
                <div className="compact-field-grid">
                  {ratingScale('readingEyeComfort', 'Eye comfort during reading overall (1-5)', 1, 5)}
                  {yesNoCheckbox('discomfortIncreased', 'Eyes felt more uncomfortable as session went on')}
                  {yesNoCheckbox('urgeRubEyes', 'Felt urge to rub eyes')}
                  {yesNoCheckbox('urgeLookAway', 'Felt urge to look away from screen')}
                  {yesNoCheckbox('urgeBlinkMore', 'Felt urge to blink more than usual')}
                  {yesNoCheckbox('eyePressureHeaviness', 'Felt pressure or heaviness around eyes')}
                </div>
              </div>

              <div className="form-section">
                <div className="section-heading compact">
                  <div>
                    <h3>Vision</h3>
                  </div>
                </div>
                <div className="compact-field-grid">
                  {yesNoCheckbox('visionClearThroughout', 'Vision felt clear throughout reading')}
                  {yesNoCheckbox('textHarderToFocus', 'Text became harder to focus on')}
                  {form.textHarderToFocus === 'Yes' ? (
                    <input
                      aria-label="When text became harder to focus"
                      value={form.textHarderToFocusTiming}
                      onChange={(event) => setFormValue('textHarderToFocusTiming', event.target.value)}
                      placeholder="When did this happen?"
                    />
                  ) : null}
                  {yesNoCheckbox('headacheDuringAfter', 'Headache during or after reading')}
                </div>
              </div>

              <div className="form-section">
                <div className="section-heading compact">
                  <div>
                    <h3>Reading Experience</h3>
                  </div>
                </div>
                <div className="compact-field-grid">
                  {ratingScale('concentrationEase', 'Ease concentrating on reading material (1-5)', 1, 5)}
                  {ratingScale('mentalFatigueEnd', 'Mental fatigue by end of session (1-5)', 1, 5)}
                  {ratingScale('physicalFatigueEnd', 'Physical tiredness by end of session (1-5)', 1, 5)}
                  {yesNoCheckbox('distractedDuringSession', 'Distracted during the session')}
                  {form.distractedDuringSession === 'Yes' ? (
                    <input
                      aria-label="Distraction details"
                      value={form.distractionDetails}
                      onChange={(event) => setFormValue('distractionDetails', event.target.value)}
                      placeholder="What distracted you?"
                    />
                  ) : null}
                </div>
              </div>

              <div className="form-section">
                <div className="section-heading compact">
                  <div>
                    <h3>Device / Environment</h3>
                  </div>
                </div>
                <div className="compact-field-grid">{comfortInputs.slice(4)}</div>
              </div>
            </>
          )}
        </div>

        <div className="action-row">
          <button className="primary-button" disabled={isSaving || !targetSessionFolder} onClick={() => void savePostSession()} type="button">
            {isSaving ? 'Saving...' : 'Save Post-Session'}
          </button>
          <button onClick={() => resetPostSessionForm()} type="button">
            Clear Form
          </button>
          <button onClick={() => setActiveTab('analysis')} type="button">
            Go to Analysis
          </button>
        </div>
      </div>
    </section>
  );
};
