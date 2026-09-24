import { useMemo } from 'react';
import { useAppStore } from '@app/state/useAppStore';
import type { SessionFormValues } from '@ipc/schemas';

const SEX_OPTIONS = ['', 'Female', 'Male', 'Intersex', 'Prefer not to say'];
const RACE_ETHNICITY_OPTIONS = [
  '',
  'American Indian or Alaska Native',
  'Asian',
  'Black or African American',
  'Hispanic or Latino',
  'Middle Eastern or North African',
  'Native Hawaiian or Pacific Islander',
  'White',
  'Multiracial',
  'Prefer not to say'
];
const CONTACT_LENS_TYPE_OPTIONS = ['', 'Soft', 'Rigid', 'Ortho-K'];
const EMOTION_OPTIONS = ['Calm', 'Focused', 'Tired', 'Stressed', 'Happy', 'Sad', 'Anxious', 'Neutral'];

const SYMPTOM_RATINGS: Array<{ key: keyof SessionFormValues; label: string }> = [
  { key: 'symptomDryness', label: 'Eye dryness right now (0-5)' },
  { key: 'symptomTiredness', label: 'Eye tiredness right now (0-5)' },
  { key: 'symptomBurningStinging', label: 'Burning or stinging right now (0-5)' },
  { key: 'symptomBlurryVision', label: 'Blurry vision right now (0-5)' },
  { key: 'symptomLightSensitivity', label: 'Light sensitivity right now (0-5)' }
];

const parseEmotionSelections = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const PreSessionPage = (): JSX.Element => {
  const sessionForm = useAppStore((state) => state.sessionForm);
  const setSessionFormValue = useAppStore((state) => state.setSessionFormValue);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const selectedEmotionSelections = useMemo(
    () => parseEmotionSelections(sessionForm.currentEmotion),
    [sessionForm.currentEmotion]
  );

  const toggleEmotionSelection = (emotion: string, checked: boolean) => {
    const nextSelections = checked
      ? [...selectedEmotionSelections, emotion]
      : selectedEmotionSelections.filter((selection) => selection !== emotion);
    setSessionFormValue('currentEmotion', nextSelections.join(', '));
  };

  const yesNoCheckbox = (
    key: keyof SessionFormValues,
    label: string,
    afterChange?: (value: 'Yes' | 'No' | '') => void
  ) => {
    const setAnswer = (value: 'Yes' | 'No', checked: boolean) => {
      const nextValue = checked ? value : '';
      setSessionFormValue(key, nextValue);
      afterChange?.(nextValue);
    };

    return (
      <div className="yes-no-question">
        <span>{label}</span>
        <div className="yes-no-options">
          <label className="checkbox-row">
            <input
              checked={sessionForm[key] === 'Yes'}
              onChange={(event) => setAnswer('Yes', event.target.checked)}
              type="checkbox"
            />
            <span>Yes</span>
          </label>
          <label className="checkbox-row">
            <input
              checked={sessionForm[key] === 'No'}
              onChange={(event) => setAnswer('No', event.target.checked)}
              type="checkbox"
            />
            <span>No</span>
          </label>
        </div>
      </div>
    );
  };

  const ratingScale = (key: keyof SessionFormValues, label: string, min: number, max: number) => {
    const options = Array.from({ length: max - min + 1 }, (_, index) => String(min + index));
    return (
      <div className="rating-question">
        <span>{label}</span>
        <div className="rating-scale" role="group" aria-label={label}>
          {options.map((option) => (
            <button
              key={option}
              className={sessionForm[key] === option ? 'selected' : ''}
              onClick={() => setSessionFormValue(key, sessionForm[key] === option ? '' : option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section className="session-layout google-form-page">
      <div className="card session-form-card google-form-card">
        <div className="section-heading">
          <div>
            <h3>Pre-Session Information</h3>
          </div>
          <p className="section-copy">
            Enter subject details, eye-health context, environment conditions, and emotion check-in before session setup.
          </p>
        </div>

        <div className="form-grid google-form-grid">
          <div className="compact-field-grid">
            <input
              aria-label="Subject ID"
              value={sessionForm.subjectId}
              onChange={(event) => setSessionFormValue('subjectId', event.target.value)}
              placeholder="ID"
            />
            <input
              aria-label="Age in years"
              value={sessionForm.subjectAge}
              onChange={(event) => setSessionFormValue('subjectAge', event.target.value)}
              min="0"
              placeholder="Age (in years)"
              type="number"
            />
            <select
              aria-label="Sex"
              className={!sessionForm.subjectSex ? 'select-placeholder' : ''}
              value={sessionForm.subjectSex}
              onChange={(event) => setSessionFormValue('subjectSex', event.target.value)}
            >
              {SEX_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option || 'Sex (optional)'}
                </option>
              ))}
            </select>
            <select
              aria-label="Ethnicity or race"
              className={!sessionForm.subjectRaceEthnicity ? 'select-placeholder' : ''}
              value={sessionForm.subjectRaceEthnicity}
              onChange={(event) => setSessionFormValue('subjectRaceEthnicity', event.target.value)}
            >
              {RACE_ETHNICITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option || 'Ethnicity/Race (optional)'}
                </option>
              ))}
            </select>
          </div>

          <div className="form-section">
            <div className="section-heading compact">
              <div>
                <h3>Eye Health</h3>
              </div>
            </div>
            <div className="compact-field-grid">
              {yesNoCheckbox('diagnosedDryEye', 'Ever diagnosed with dry eye disease')}
              {yesNoCheckbox('usesEyeDrops', 'Currently uses eye drops')}
              {sessionForm.usesEyeDrops === 'Yes' ? (
                <input
                  aria-label="Eye drops kind and frequency"
                  value={sessionForm.eyeDropsDetails}
                  onChange={(event) => setSessionFormValue('eyeDropsDetails', event.target.value)}
                  placeholder="Eye drops kind and how often"
                />
              ) : null}
              {yesNoCheckbox('eyeDropsLastTwoHours', 'Used eye drops in the last 2 hours')}
              {yesNoCheckbox('wearsContactLenses', 'Wears contact lenses', (value) => {
                if (value !== 'Yes') {
                  setSessionFormValue('contactLensType', '');
                }
              })}
              {sessionForm.wearsContactLenses === 'Yes' ? (
                <select
                  aria-label="Contact lens type"
                  className={!sessionForm.contactLensType ? 'select-placeholder' : ''}
                  value={sessionForm.contactLensType}
                  onChange={(event) => setSessionFormValue('contactLensType', event.target.value)}
                >
                  {CONTACT_LENS_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option || 'Contact lens type'}
                    </option>
                  ))}
                </select>
              ) : null}
              {yesNoCheckbox('wearingContactLensesNow', 'Wearing contact lenses right now')}
              {yesNoCheckbox('wornContactsToday', 'Wore contact lenses earlier today')}
              {yesNoCheckbox('wearsGlasses', 'Wears glasses')}
              {sessionForm.wearsGlasses === 'Yes' ? yesNoCheckbox('wearingGlassesToday', 'Wearing glasses today') : null}
              {yesNoCheckbox('recentEyeSurgery', 'Recent eye surgery or procedures')}
              {sessionForm.recentEyeSurgery === 'Yes' ? (
                <input
                  aria-label="Recent eye surgery or procedure details"
                  value={sessionForm.eyeSurgeryDetails}
                  onChange={(event) => setSessionFormValue('eyeSurgeryDetails', event.target.value)}
                  placeholder="Eye surgery/procedure details"
                />
              ) : null}
              {yesNoCheckbox('eyeAllergies', 'Known allergies that affect eyes')}
              {sessionForm.eyeAllergies === 'Yes' ? (
                <input
                  aria-label="Eye allergy details"
                  value={sessionForm.eyeAllergyDetails}
                  onChange={(event) => setSessionFormValue('eyeAllergyDetails', event.target.value)}
                  placeholder="Eye allergy details"
                />
              ) : null}
            </div>
            <textarea
              aria-label="Additional notes"
              value={sessionForm.notes}
              onChange={(event) => setSessionFormValue('notes', event.target.value)}
              rows={3}
              placeholder="Type any additional notes here (e.g. Frontal lighting, no glasses, minimal head motion)."
            />
          </div>

          <div className="form-section">
            <div className="section-heading compact">
              <div>
                <h3>Today's Symptoms</h3>
              </div>
              <p className="field-helper">0 = no signs of symptoms; 5 = extremely severe.</p>
            </div>
            <div className="compact-field-grid">
              {SYMPTOM_RATINGS.map((rating) => ratingScale(rating.key, rating.label, 0, 5))}
            </div>
          </div>

          <div className="form-section">
            <div className="section-heading compact">
              <div>
                <h3>General Health Today</h3>
              </div>
            </div>
            <div className="compact-field-grid">
              <input
                aria-label="Hours of sleep last night"
                value={sessionForm.sleepHours}
                onChange={(event) => setSessionFormValue('sleepHours', event.target.value)}
                min="0"
                placeholder="Hours of sleep last night"
                type="number"
              />
              {yesNoCheckbox('consumedCaffeine', 'Consumed caffeine today')}
              {sessionForm.consumedCaffeine === 'Yes' ? (
                <input
                  aria-label="Caffeine timing"
                  value={sessionForm.caffeineTiming}
                  onChange={(event) => setSessionFormValue('caffeineTiming', event.target.value)}
                  placeholder="How long ago?"
                />
              ) : null}
              {yesNoCheckbox('consumedAlcohol24h', 'Consumed alcohol in the last 24 hours')}
              <input
                aria-label="Medications that could affect alertness or eye health"
                value={sessionForm.alertnessEyeMeds}
                onChange={(event) => setSessionFormValue('alertnessEyeMeds', event.target.value)}
                placeholder="Medications affecting alertness or eye health"
              />
              {yesNoCheckbox('feelingSick', 'Feeling sick today')}
              {ratingScale('stressLevel', 'Stress level today (1-5)', 1, 5)}
              {ratingScale('energyLevel', 'Energy or alertness right now (1-5)', 1, 5)}
            </div>
          </div>

          <div className="form-section">
            <div className="section-heading compact">
              <div>
                <h3>Environment Check</h3>
              </div>
            </div>
            <div className="compact-field-grid">
              <input
                aria-label="Screen or reading time before this session"
                value={sessionForm.screenReadingDurationToday}
                onChange={(event) => setSessionFormValue('screenReadingDurationToday', event.target.value)}
                placeholder="Screen or reading time before session"
              />
              {yesNoCheckbox('priorAirConditioningHeating', 'In air conditioning or heated environment before arriving')}
              {yesNoCheckbox('priorWindSun', 'Outdoors in wind or sun before arriving')}
              {yesNoCheckbox('dryEnvironmentToday', 'In a dry environment today')}
            </div>
          </div>

          <div className="form-section">
            <div className="section-heading compact">
              <div>
                <h3>Recording Environment</h3>
              </div>
            </div>
            <div className="compact-field-grid">
              <input
                aria-label="Room temperature"
                value={sessionForm.roomTemperature}
                onChange={(event) => setSessionFormValue('roomTemperature', event.target.value)}
                placeholder="Room temperature"
              />
              <input
                aria-label="Device being used"
                value={sessionForm.deviceUsed}
                onChange={(event) => setSessionFormValue('deviceUsed', event.target.value)}
                placeholder="Device being used (Kindle, screen type, etc.)"
              />
              <input
                aria-label="Screen brightness setting"
                value={sessionForm.screenBrightness}
                onChange={(event) => setSessionFormValue('screenBrightness', event.target.value)}
                placeholder="Screen brightness setting"
              />
              <input
                aria-label="Viewing distance from screen in centimeters"
                value={sessionForm.viewingDistanceCm}
                onChange={(event) => setSessionFormValue('viewingDistanceCm', event.target.value)}
                min="0"
                placeholder="Viewing distance from screen (cm)"
                type="number"
              />
            </div>
          </div>

          <div className="form-section">
            <div className="section-heading compact">
              <div>
                <h3>Emotion Check</h3>
              </div>
            </div>
            <div className="checkbox-grid">
              {EMOTION_OPTIONS.map((emotion) => (
                <label className="checkbox-row prompt-checkbox" key={emotion}>
                  <input
                    checked={selectedEmotionSelections.includes(emotion)}
                    onChange={(event) => toggleEmotionSelection(emotion, event.target.checked)}
                    type="checkbox"
                  />
                  <span>{emotion}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="action-row">
          <button className="primary-button" onClick={() => setActiveTab('session')} type="button">
            Continue to Session Setup
          </button>
        </div>
      </div>
    </section>
  );
};
