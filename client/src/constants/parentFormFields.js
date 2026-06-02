/** Labels for parent questionnaire (must match server field ids). */
export const PARENT_FORM_FIELD_GROUPS = [
  {
    id: 'basics',
    title: 'Basics',
    fields: [
      { id: 'sex', label: 'Gender' },
      { id: 'dob', label: 'Date of Birth' },
      { id: 'age', label: 'Age (if Date of Birth unknown)' },
      { id: 'school', label: 'School' },
      { id: 'grade', label: 'Grade' },
      { id: 'class', label: 'Class' },
      { id: 'notes', label: 'Notes' }
    ]
  },
  {
    id: 'contact',
    title: 'Contact',
    fields: [
      { id: 'guardianName', label: 'Guardian Name' },
      { id: 'relationship', label: 'Relationship' },
      { id: 'guardianPhone', label: 'Phone' },
      { id: 'messenger', label: 'Messenger' },
      { id: 'address', label: 'Address' }
    ]
  },
  {
    id: 'medical',
    title: 'Medical',
    fields: [
      { id: 'allergy', label: 'Allergy' },
      { id: 'medicalHistory', label: 'Medical History' }
    ]
  }
];

export const PARENT_FORM_FIELD_DEFS = PARENT_FORM_FIELD_GROUPS.flatMap((group) => group.fields);

export const PARENT_FORM_ALL_FIELD_MAP = Object.fromEntries(
  PARENT_FORM_FIELD_DEFS.map((field) => [field.id, true])
);
