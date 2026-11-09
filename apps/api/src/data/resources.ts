export type ResourceTopic =
  | 'DBMS'
  | 'SQL'
  | 'OS'
  | 'CN'
  | 'OOP'
  | 'DSA'
  | 'System Design';

export type ResourceType = 'documentation' | 'tutorial' | 'interactive' | 'guide';

export interface LearningResource {
  id: string;
  topic: ResourceTopic;
  title: string;
  url: string;
  description: string;
  type: ResourceType;
}

export const RESOURCE_TOPICS: readonly ResourceTopic[] = [
  'DBMS',
  'SQL',
  'OS',
  'CN',
  'OOP',
  'DSA',
  'System Design',
] as const;

export const LEARNING_RESOURCES: readonly LearningResource[] = [
  // DBMS
  {
    id: 'dbms-acid-transactions',
    topic: 'DBMS',
    title: 'GeeksforGeeks: ACID Properties in DBMS',
    url: 'https://www.geeksforgeeks.org/acid-properties-in-dbms/',
    description: 'Foundational guide explaining atomicity, consistency, isolation, and durability.',
    type: 'guide',
  },
  {
    id: 'dbms-concurrency-mvcc',
    topic: 'DBMS',
    title: 'PostgreSQL Documentation: Concurrency Control & MVCC',
    url: 'https://www.postgresql.org/docs/current/mvcc.html',
    description: 'Official PostgreSQL reference on multi-version concurrency control and isolation levels.',
    type: 'documentation',
  },
  {
    id: 'dbms-indexing-guide',
    topic: 'DBMS',
    title: 'PostgreSQL Documentation: Indexes',
    url: 'https://www.postgresql.org/docs/current/indexes.html',
    description: 'Documentation covering B-tree, Hash, GiST indexes and query planner utilization.',
    type: 'documentation',
  },
  {
    id: 'dbms-architecture-tutorial',
    topic: 'DBMS',
    title: 'GeeksforGeeks: DBMS Architecture & Core Concepts',
    url: 'https://www.geeksforgeeks.org/dbms/',
    description: 'Overview of relational models, normal forms, schemas, and storage engines.',
    type: 'tutorial',
  },

  // SQL
  {
    id: 'sql-queries-joins',
    topic: 'SQL',
    title: 'PostgreSQL Documentation: Queries & Table Joins',
    url: 'https://www.postgresql.org/docs/current/queries.html',
    description: 'Canonical reference for SELECT queries, joins, subqueries, grouping, and aggregations.',
    type: 'documentation',
  },
  {
    id: 'sql-interactive-practice',
    topic: 'SQL',
    title: 'SQLBolt: Interactive SQL Lessons',
    url: 'https://sqlbolt.com/',
    description: 'Interactive browser exercises covering filtering, multi-table joins, and schema changes.',
    type: 'interactive',
  },
  {
    id: 'sql-indexing-performance',
    topic: 'SQL',
    title: 'Use The Index, Luke! SQL Performance Guide',
    url: 'https://use-the-index-luke.com/',
    description: 'Developer guide to indexing mechanics, execution plans, range scans, and tuning.',
    type: 'guide',
  },
  {
    id: 'sql-reference-tutorial',
    topic: 'SQL',
    title: 'W3Schools: SQL Tutorial & Reference',
    url: 'https://www.w3schools.com/sql/',
    description: 'Practical syntax reference and tutorials for SQL statements, joins, and constraints.',
    type: 'tutorial',
  },

  // OS
  {
    id: 'os-three-easy-pieces',
    topic: 'OS',
    title: 'Operating Systems: Three Easy Pieces (OSTEP)',
    url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/',
    description: 'Classic open textbook covering virtualization, concurrency primitives, and persistence.',
    type: 'guide',
  },
  {
    id: 'os-core-concepts',
    topic: 'OS',
    title: 'GeeksforGeeks: Operating Systems Tutorial',
    url: 'https://www.geeksforgeeks.org/operating-systems/',
    description: 'Review of processes, threads, CPU scheduling, virtual memory, and page replacement.',
    type: 'tutorial',
  },
  {
    id: 'os-kernel-architecture',
    topic: 'OS',
    title: 'The Linux Kernel Documentation',
    url: 'https://docs.kernel.org/',
    description: 'Authoritative documentation on Linux kernel subsystems and memory management.',
    type: 'documentation',
  },
  {
    id: 'os-concurrency-deadlocks',
    topic: 'OS',
    title: 'GeeksforGeeks: Deadlock and Synchronization in OS',
    url: 'https://www.geeksforgeeks.org/introduction-of-deadlock-in-operating-system/',
    description: 'Comprehensive guide on race conditions, mutexes, semaphores, and deadlock handling.',
    type: 'guide',
  },

  // CN
  {
    id: 'cn-http-overview',
    topic: 'CN',
    title: 'MDN Web Docs: An Overview of HTTP',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview',
    description: 'MDN reference on HTTP protocol semantics, request/response cycles, and status codes.',
    type: 'documentation',
  },
  {
    id: 'cn-osi-model',
    topic: 'CN',
    title: 'GeeksforGeeks: Open Systems Interconnection (OSI) Model',
    url: 'https://www.geeksforgeeks.org/open-systems-interconnection-model-osi/',
    description: 'Layer-by-layer breakdown of the 7-layer OSI model, packet flow, and protocols.',
    type: 'guide',
  },
  {
    id: 'cn-tcp-ip-suite',
    topic: 'CN',
    title: 'GeeksforGeeks: TCP/IP Model and Protocol Suite',
    url: 'https://www.geeksforgeeks.org/tcp-ip-model/',
    description: 'Architecture of the 4-layer TCP/IP suite covering handshakes, flow, and routing.',
    type: 'tutorial',
  },
  {
    id: 'cn-internet-mechanics',
    topic: 'CN',
    title: 'MDN Web Docs: How the Internet Works',
    url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Web_mechanics/How_does_the_Internet_work',
    description: 'Foundational guide explaining packets, routers, IP addressing, and DNS lookups.',
    type: 'guide',
  },

  // OOP
  {
    id: 'oop-design-patterns',
    topic: 'OOP',
    title: 'Refactoring Guru: Design Patterns Catalog',
    url: 'https://refactoring.guru/design-patterns/catalog',
    description: 'Visual catalog of creational, structural, and behavioral design patterns.',
    type: 'guide',
  },
  {
    id: 'oop-solid-principles',
    topic: 'OOP',
    title: 'DigitalOcean: SOLID Principles of Object-Oriented Design',
    url: 'https://www.digitalocean.com/community/conceptual-articles/s-o-l-i-d-the-first-five-principles-of-object-oriented-design',
    description: 'Clear conceptual guide explaining each of the five SOLID software design principles.',
    type: 'guide',
  },
  {
    id: 'oop-core-concepts',
    topic: 'OOP',
    title: 'Oracle Java Documentation: OOP Concepts',
    url: 'https://docs.oracle.com/javase/tutorial/java/concepts/',
    description: 'Official introduction to encapsulation, inheritance, polymorphism, and interfaces.',
    type: 'documentation',
  },
  {
    id: 'oop-principles-guide',
    topic: 'OOP',
    title: 'GeeksforGeeks: Object-Oriented Programming Concepts',
    url: 'https://www.geeksforgeeks.org/object-oriented-programming-oops-concept-in-java/',
    description: 'Study guide covering classes, abstraction, coupling, cohesion, and composition.',
    type: 'tutorial',
  },

  // DSA
  {
    id: 'dsa-neetcode-roadmap',
    topic: 'DSA',
    title: 'NeetCode Roadmap: Structured Algorithms Practice',
    url: 'https://neetcode.io/roadmap',
    description: 'Interactive roadmap covering arrays, trees, dynamic programming, and graphs.',
    type: 'interactive',
  },
  {
    id: 'dsa-comprehensive-guide',
    topic: 'DSA',
    title: 'GeeksforGeeks: Data Structures and Algorithms',
    url: 'https://www.geeksforgeeks.org/learn-data-structures-and-algorithms-dsa-tutorial/',
    description: 'Exhaustive reference with asymptotic complexity, trees, graphs, and sorting.',
    type: 'tutorial',
  },
  {
    id: 'dsa-visualgo',
    topic: 'DSA',
    title: 'VisuAlgo: Visualizing Data Structures and Algorithms',
    url: 'https://visualgo.net/en',
    description: 'Interactive animated visualizations demonstrating algorithmic mechanics and trees.',
    type: 'interactive',
  },
  {
    id: 'dsa-khan-academy',
    topic: 'DSA',
    title: 'Khan Academy: Algorithms Curriculum',
    url: 'https://www.khanacademy.org/computing/computer-science/algorithms',
    description: 'Course by Thomas Cormen covering asymptotic notation, divide-and-conquer, and sorting.',
    type: 'tutorial',
  },

  // System Design
  {
    id: 'system-design-tutorial',
    topic: 'System Design',
    title: 'GeeksforGeeks: System Design Tutorial & Architecture',
    url: 'https://www.geeksforgeeks.org/system-design-tutorial/',
    description: 'Comprehensive guide covering high-level architecture, caching, load balancing, and scalability.',
    type: 'tutorial',
  },
  {
    id: 'system-design-architecture',
    topic: 'System Design',
    title: 'Martin Fowler: Software Architecture Guide',
    url: 'https://martinfowler.com/architecture/',
    description: 'Authoritative guide to software architecture, microservices, and system boundaries.',
    type: 'guide',
  },
  {
    id: 'system-design-aws-framework',
    topic: 'System Design',
    title: 'AWS Well-Architected Framework',
    url: 'https://aws.amazon.com/architecture/well-architected/',
    description: 'Architectural best practices for security, reliability, performance, and scalability.',
    type: 'documentation',
  },
  {
    id: 'system-design-bytebytego',
    topic: 'System Design',
    title: 'ByteByteGo: System Design Architecture Guides',
    url: 'https://bytebytego.com/',
    description: 'Visual guides on rate limiting, distributed caching, and message queues.',
    type: 'guide',
  },
];

const RESOURCE_MAP = new Map<string, LearningResource>(
  LEARNING_RESOURCES.map((r) => [r.id, r])
);

export const TOPIC_ALIASES: Readonly<Record<string, ResourceTopic>> = {
  // DBMS
  database: 'DBMS',
  databases: 'DBMS',
  rdbms: 'DBMS',
  'relational-databases': 'DBMS',
  acid: 'DBMS',
  transactions: 'DBMS',

  // SQL
  postgres: 'SQL',
  postgresql: 'SQL',
  mysql: 'SQL',
  queries: 'SQL',
  joins: 'SQL',

  // OS
  'operating-systems': 'OS',
  'operating-system': 'OS',
  concurrency: 'OS',
  threads: 'OS',
  threading: 'OS',
  multithreading: 'OS',
  processes: 'OS',
  deadlocks: 'OS',
  'memory-management': 'OS',

  // CN
  'computer-networks': 'CN',
  networking: 'CN',
  network: 'CN',
  tcp: 'CN',
  'tcp-ip': 'CN',
  udp: 'CN',
  http: 'CN',
  https: 'CN',
  dns: 'CN',
  osi: 'CN',

  // OOP
  'object-oriented-programming': 'OOP',
  'object-oriented': 'OOP',
  oops: 'OOP',
  solid: 'OOP',
  'solid-principles': 'OOP',
  'design-patterns': 'OOP',
  'clean-code': 'OOP',

  // DSA
  'data-structures': 'DSA',
  algorithms: 'DSA',
  'data-structures-and-algorithms': 'DSA',
  trees: 'DSA',
  graphs: 'DSA',
  'dynamic-programming': 'DSA',
  sorting: 'DSA',

  // System Design
  'system-design': 'System Design',
  'distributed-systems': 'System Design',
  scalability: 'System Design',
  microservices: 'System Design',
  caching: 'System Design',
  'load-balancing': 'System Design',
  architecture: 'System Design',
};

export function normalizeTopic(input: string): ResourceTopic | undefined {
  const key = input.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (TOPIC_ALIASES[key]) {
    return TOPIC_ALIASES[key];
  }
  return RESOURCE_TOPICS.find((t) => t.toLowerCase() === input.trim().toLowerCase());
}

export function getResourceById(id: string): LearningResource | undefined {
  return RESOURCE_MAP.get(id);
}

export function isValidResourceId(id: string): boolean {
  return RESOURCE_MAP.has(id);
}

export function getResourcesByTopic(topic: ResourceTopic | string): LearningResource[] {
  const canonical = normalizeTopic(topic);
  if (!canonical) {
    return [];
  }
  return LEARNING_RESOURCES.filter((r) => r.topic === canonical);
}
