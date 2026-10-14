/* ==========================================================================
   CivicFix — mock data layer
   Seeds localStorage on first run so the prototype feels alive.
   ========================================================================== */
window.MOCK = {
  categories: [
    { id: "pothole",      label: "Pothole",            icon: "🕳️" },
    { id: "drainage",     label: "Drainage / Overflow", icon: "🌊" },
    { id: "streetlight",  label: "Streetlight Out",     icon: "💡" },
    { id: "garbage",      label: "Garbage Dump",        icon: "🗑️" },
    { id: "water",        label: "Water Leakage",       icon: "🚰" },
    { id: "other",        label: "Other",               icon: "📍" }
  ],

  teams: [
    "Roads & Potholes Crew",
    "Drainage Unit",
    "Electrical Team",
    "Sanitation Dept.",
    "Water Works"
  ],

  /* Central sample coordinates (used when the user skips the map step) */
  defaultCenter: { lat: 12.9716, lng: 77.5946, address: "MG Road, Central District" },

  issues: [
    {
      id: "CF-1041", title: "Deep pothole on main crossroad",
      category: "pothole", priority: "High", status: "In Progress",
      team: "Roads & Potholes Crew",
      description: "Large pothole roughly 60cm wide near the signal. Two-wheelers swerve into the fast lane to avoid it. Worse after rain.",
      address: "Junction of 5th Main & Ring Road, Ward 42",
      lat: 12.9763, lng: 77.5929,
      createdAt: "2026-10-06T08:12:00.000Z",
      photos: [], notes: [
        { at: "2026-10-07T09:30:00.000Z", by: "Ops Desk", text: "Team dispatched, barricade placed." }
      ],
      history: [
        { status: "New", at: "2026-10-06T08:12:00.000Z" },
        { status: "Assigned", at: "2026-10-06T14:02:00.000Z" },
        { status: "In Progress", at: "2026-10-07T09:30:00.000Z" }
      ]
    },
    {
      id: "CF-1040", title: "Storm drain blocked, water pooling",
      category: "drainage", priority: "High", status: "Assigned",
      team: "Drainage Unit",
      description: "Drain grate clogged with leaves and silt. Water pools 4-5 inches deep across the footpath after every shower.",
      address: "Opposite City Library, Nehru Street",
      lat: 12.9641, lng: 77.6011,
      createdAt: "2026-10-05T17:41:00.000Z",
      photos: [], notes: [],
      history: [
        { status: "New", at: "2026-10-05T17:41:00.000Z" },
        { status: "Assigned", at: "2026-10-06T10:15:00.000Z" }
      ]
    },
    {
      id: "CF-1039", title: "Streetlight out for two weeks",
      category: "streetlight", priority: "Medium", status: "New",
      team: "",
      description: "Pole #SL-229 has been dark since the 22nd. The stretch is very dark for pedestrians after 8pm.",
      address: "Lakeside Walk, near Gate 3",
      lat: 12.9805, lng: 77.5852,
      createdAt: "2026-10-04T20:05:00.000Z",
      photos: [], notes: [],
      history: [{ status: "New", at: "2026-10-04T20:05:00.000Z" }]
    },
    {
      id: "CF-1038", title: "Illegal garbage dump behind market",
      category: "garbage", priority: "Medium", status: "In Progress",
      team: "Sanitation Dept.",
      description: "Waste piling up on the vacant plot. Strong odour and stray animals. Needs clearing and a no-dumping board.",
      address: "Rear of Gandhi Market, Block C",
      lat: 12.9588, lng: 77.6078,
      createdAt: "2026-10-03T11:22:00.000Z",
      photos: [], notes: [
        { at: "2026-10-05T08:00:00.000Z", by: "Sanitation", text: "First clearance done, second trip scheduled." }
      ],
      history: [
        { status: "New", at: "2026-10-03T11:22:00.000Z" },
        { status: "Assigned", at: "2026-10-04T09:10:00.000Z" },
        { status: "In Progress", at: "2026-10-05T08:00:00.000Z" }
      ]
    },
    {
      id: "CF-1037", title: "Water pipe leaking onto footpath",
      category: "water", priority: "High", status: "Closed",
      team: "Water Works",
      description: "Continuous leak from a joint near the meter box. Footpath is slippery and water is being wasted.",
      address: "12, Rose Garden Layout",
      lat: 12.9699, lng: 77.6142,
      createdAt: "2026-09-28T07:50:00.000Z",
      photos: [], notes: [
        { at: "2026-10-01T12:00:00.000Z", by: "Water Works", text: "Joint replaced and tested. Closed." }
      ],
      history: [
        { status: "New", at: "2026-09-28T07:50:00.000Z" },
        { status: "Assigned", at: "2026-09-28T15:30:00.000Z" },
        { status: "In Progress", at: "2026-09-30T10:00:00.000Z" },
        { status: "Closed", at: "2026-10-01T12:00:00.000Z" }
      ]
    },
    {
      id: "CF-1036", title: "Cracked footpath slab near school",
      category: "other", priority: "Low", status: "Assigned",
      team: "Roads & Potholes Crew",
      description: "Broken slab creates a trip hazard for children walking to the school gate.",
      address: "St. Anne's School Road",
      lat: 12.9732, lng: 77.5993,
      createdAt: "2026-10-02T09:05:00.000Z",
      photos: [], notes: [],
      history: [
        { status: "New", at: "2026-10-02T09:05:00.000Z" },
        { status: "Assigned", at: "2026-10-03T08:40:00.000Z" }
      ]
    },
    {
      id: "CF-1035", title: "Pothole cluster after flyover",
      category: "pothole", priority: "Medium", status: "Closed",
      team: "Roads & Potholes Crew",
      description: "Three shallow potholes in a row on the descent ramp.",
      address: "Flyover descent, East Approach",
      lat: 12.9530, lng: 77.5901,
      createdAt: "2026-09-24T13:15:00.000Z",
      photos: [], notes: [],
      history: [
        { status: "New", at: "2026-09-24T13:15:00.000Z" },
        { status: "Assigned", at: "2026-09-25T09:00:00.000Z" },
        { status: "In Progress", at: "2026-09-27T10:30:00.000Z" },
        { status: "Closed", at: "2026-09-29T16:20:00.000Z" }
      ]
    },
    {
      id: "CF-1034", title: "Overflowing storm drain at bus stop",
      category: "drainage", priority: "Medium", status: "New",
      team: "",
      description: "Drain overflows onto the bus bay making boarding difficult during peak hours.",
      address: "Central Bus Stop, Platform 2 side",
      lat: 12.9678, lng: 77.6055,
      createdAt: "2026-10-08T18:33:00.000Z",
      photos: [], notes: [],
      history: [{ status: "New", at: "2026-10-08T18:33:00.000Z" }]
    }
  ]
};