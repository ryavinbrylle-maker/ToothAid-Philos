import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Child from '../models/Child.js';
import Visit from '../models/Visit.js';
import User from '../models/User.js';
import { connectDB } from '../db.js';

dotenv.config();

const seedData = async () => {
  try {
    await connectDB();

    // Clear existing data
    await Child.deleteMany({});
    await Visit.deleteMany({});

    // Create demo user
    const existingUser = await User.findOne({ username: 'demo' });
    if (!existingUser) {
      await User.create({ username: 'demo', password: 'demo' });
      console.log('Created demo user (username: demo, password: demo)');
    }

    // Sample children (field-complete for demo)
    const children = [
      {
        childId: 'child-001',
        fullName: 'Maria Santos',
        firstName: 'Maria',
        lastName: 'Santos',
        dob: new Date('2015-03-15'),
        sex: 'F',
        school: 'Boctol Elementary School',
        grade: 'Grade 3',
        class: 'A',
        barangay: 'Boctol',
        guardianPhone: '09123456789',
        messenger: 'maria.santos',
        priority: 'P1',
        consentGeneralReceivedAt: new Date('2024-01-10'),
        consentSpecific: [
          { procedure: 'Extraction', date: new Date('2024-02-05') }
        ],
        notes: 'Needs follow-up consent for extraction',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15')
      },
      {
        childId: 'child-002',
        fullName: 'Juan Dela Cruz',
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        age: 8,
        sex: 'M',
        school: 'Boctol Elementary School',
        grade: 'Grade 2',
        class: 'B',
        barangay: 'Boctol',
        guardianPhone: '09187654321',
        messenger: 'juan.delacruz',
        priority: 'P0',
        consentGeneralReceivedAt: new Date('2024-01-12'),
        consentSpecific: [],
        notes: 'High priority case',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-16'),
        updatedAt: new Date('2024-01-16')
      },
      {
        childId: 'child-003',
        fullName: 'Ana Garcia',
        firstName: 'Ana',
        lastName: 'Garcia',
        dob: new Date('2016-07-20'),
        sex: 'F',
        school: 'Upland Jagna Primary',
        grade: 'Grade 1',
        class: 'A',
        barangay: 'Upland',
        guardianPhone: '09001112223',
        messenger: 'ana.garcia',
        priority: 'P3',
        consentGeneralReceivedAt: new Date('2024-01-14'),
        consentSpecific: [],
        notes: 'Routine check',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-17'),
        updatedAt: new Date('2024-01-17')
      },
      // Additional 10 complete demo children
      {
        childId: 'child-004',
        fullName: 'Liam Reyes',
        firstName: 'Liam',
        lastName: 'Reyes',
        dob: new Date('2014-11-08'),
        sex: 'M',
        school: 'Boctol Elementary School',
        grade: 'Grade 4',
        class: 'A',
        barangay: 'Boctol',
        guardianPhone: '09170000004',
        messenger: 'liam.reyes',
        priority: 'P2',
        consentGeneralReceivedAt: new Date('2024-01-11'),
        consentSpecific: [{ procedure: 'Filling', date: new Date('2024-02-01') }],
        notes: 'Sensitive to cold drinks',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-18'),
        updatedAt: new Date('2024-01-18')
      },
      {
        childId: 'child-005',
        fullName: 'Sofia Mendoza',
        firstName: 'Sofia',
        lastName: 'Mendoza',
        dob: new Date('2015-05-02'),
        sex: 'F',
        school: 'Boctol Elementary School',
        grade: 'Grade 3',
        class: 'C',
        barangay: 'Boctol',
        guardianPhone: '09170000005',
        messenger: 'sofia.mendoza',
        priority: 'P1',
        consentGeneralReceivedAt: new Date('2024-01-09'),
        consentSpecific: [{ procedure: 'Extraction', date: new Date('2024-02-10') }],
        notes: 'Reported tooth pain last week',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-19'),
        updatedAt: new Date('2024-01-19')
      },
      {
        childId: 'child-006',
        fullName: 'Noah Lim',
        firstName: 'Noah',
        lastName: 'Lim',
        age: 7,
        sex: 'M',
        school: 'Central Primary School',
        grade: 'Grade 2',
        class: 'A',
        barangay: 'Central',
        guardianPhone: '09170000006',
        messenger: 'noah.lim',
        priority: 'P3',
        consentGeneralReceivedAt: new Date('2024-01-08'),
        consentSpecific: [],
        notes: 'First time visit',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-20'),
        updatedAt: new Date('2024-01-20')
      },
      {
        childId: 'child-007',
        fullName: 'Emma Cruz',
        firstName: 'Emma',
        lastName: 'Cruz',
        dob: new Date('2016-09-12'),
        sex: 'F',
        school: 'Central Primary School',
        grade: 'Grade 1',
        class: 'B',
        barangay: 'Central',
        guardianPhone: '09170000007',
        messenger: 'emma.cruz',
        priority: 'P2',
        consentGeneralReceivedAt: new Date('2024-01-13'),
        consentSpecific: [{ procedure: 'Sealant', date: new Date('2024-02-02') }],
        notes: 'Needs sealant on molars',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-21'),
        updatedAt: new Date('2024-01-21')
      },
      {
        childId: 'child-008',
        fullName: 'Ava Flores',
        firstName: 'Ava',
        lastName: 'Flores',
        dob: new Date('2013-02-27'),
        sex: 'F',
        school: 'Central Primary School',
        grade: 'Grade 5',
        class: 'A',
        barangay: 'Central',
        guardianPhone: '09170000008',
        messenger: 'ava.flores',
        priority: 'P0',
        consentGeneralReceivedAt: new Date('2024-01-05'),
        consentSpecific: [{ procedure: 'Extraction', date: new Date('2024-02-15') }],
        notes: 'Swelling observed previously',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-22'),
        updatedAt: new Date('2024-01-22')
      },
      {
        childId: 'child-009',
        fullName: 'Ethan Ramos',
        firstName: 'Ethan',
        lastName: 'Ramos',
        age: 9,
        sex: 'M',
        school: 'Upland Jagna Primary',
        grade: 'Grade 4',
        class: 'B',
        barangay: 'Upland',
        guardianPhone: '09170000009',
        messenger: 'ethan.ramos',
        priority: 'P1',
        consentGeneralReceivedAt: new Date('2024-01-06'),
        consentSpecific: [{ procedure: 'Filling', date: new Date('2024-02-06') }],
        notes: 'Multiple caries suspected',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-23'),
        updatedAt: new Date('2024-01-23')
      },
      {
        childId: 'child-010',
        fullName: 'Mia Navarro',
        firstName: 'Mia',
        lastName: 'Navarro',
        dob: new Date('2017-01-19'),
        sex: 'F',
        school: 'Upland Jagna Primary',
        grade: 'Kindergarten',
        class: 'A',
        barangay: 'Upland',
        guardianPhone: '09170000010',
        messenger: 'mia.navarro',
        priority: 'P3',
        consentGeneralReceivedAt: new Date('2024-01-07'),
        consentSpecific: [],
        notes: 'Routine screening',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-24'),
        updatedAt: new Date('2024-01-24')
      },
      {
        childId: 'child-011',
        fullName: 'Isabella Tan',
        firstName: 'Isabella',
        lastName: 'Tan',
        dob: new Date('2014-06-30'),
        sex: 'F',
        school: 'Boctol Elementary School',
        grade: 'Grade 4',
        class: 'C',
        barangay: 'Boctol',
        guardianPhone: '09170000011',
        messenger: 'isabella.tan',
        priority: 'P2',
        consentGeneralReceivedAt: new Date('2024-01-16'),
        consentSpecific: [{ procedure: 'Cleaning', date: new Date('2024-02-03') }],
        notes: 'Plaque build-up',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-25'),
        updatedAt: new Date('2024-01-25')
      },
      {
        childId: 'child-012',
        fullName: 'Lucas Aquino',
        firstName: 'Lucas',
        lastName: 'Aquino',
        age: 10,
        sex: 'M',
        school: 'Central Primary School',
        grade: 'Grade 5',
        class: 'B',
        barangay: 'Central',
        guardianPhone: '09170000012',
        messenger: 'lucas.aquino',
        priority: 'P1',
        consentGeneralReceivedAt: new Date('2024-01-04'),
        consentSpecific: [{ procedure: 'Filling', date: new Date('2024-02-12') }],
        notes: 'Needs composite filling',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-26'),
        updatedAt: new Date('2024-01-26')
      },
      {
        childId: 'child-013',
        fullName: 'Charlotte Diaz',
        firstName: 'Charlotte',
        lastName: 'Diaz',
        dob: new Date('2015-12-03'),
        sex: 'F',
        school: 'Upland Jagna Primary',
        grade: 'Grade 3',
        class: 'A',
        barangay: 'Upland',
        guardianPhone: '09170000013',
        messenger: 'charlotte.diaz',
        priority: 'P0',
        consentGeneralReceivedAt: new Date('2024-01-03'),
        consentSpecific: [{ procedure: 'Extraction', date: new Date('2024-02-18') }],
        notes: 'Pain + swelling history',
        createdBy: 'demo',
        updatedBy: 'demo',
        createdAt: new Date('2024-01-27'),
        updatedAt: new Date('2024-01-27')
      }
    ];

    const createdChildren = await Child.insertMany(children);
    console.log(`Created ${createdChildren.length} children`);

    // Sample visits
    const visits = [
      {
        visitId: 'visit-001',
        childId: 'child-001',
        date: new Date('2024-01-20'),
        painFlag: true,
        swellingFlag: false,
        decayedTeeth: 2,
        missingTeeth: 0,
        filledTeeth: 1,
        treatmentTypes: ['Cleaning', 'Fluoride'],
        notes: 'Initial screening completed',
        createdBy: 'demo',
        createdAt: new Date('2024-01-20')
      },
      {
        visitId: 'visit-002',
        childId: 'child-001',
        date: new Date('2024-02-20'),
        painFlag: false,
        swellingFlag: false,
        decayedTeeth: 1,
        missingTeeth: 0,
        filledTeeth: 2,
        treatmentTypes: ['Filling'],
        notes: 'Cavity filled',
        createdBy: 'demo',
        createdAt: new Date('2024-02-20')
      },
      {
        visitId: 'visit-003',
        childId: 'child-002',
        date: new Date('2024-01-25'),
        painFlag: true,
        swellingFlag: true,
        decayedTeeth: 4,
        missingTeeth: 1,
        filledTeeth: 0,
        treatmentTypes: [],
        notes: 'Severe case, needs attention',
        createdBy: 'demo',
        createdAt: new Date('2024-01-25')
      },
      {
        visitId: 'visit-004',
        childId: 'child-003',
        date: new Date('2024-01-30'),
        painFlag: false,
        swellingFlag: false,
        decayedTeeth: 0,
        missingTeeth: 0,
        filledTeeth: 0,
        treatmentTypes: ['Cleaning'],
        notes: 'Healthy teeth',
        createdBy: 'demo',
        createdAt: new Date('2024-01-30')
      }
    ];

    const createdVisits = await Visit.insertMany(visits);
    console.log(`Created ${createdVisits.length} visits`);

    console.log('Seed data created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seedData();
