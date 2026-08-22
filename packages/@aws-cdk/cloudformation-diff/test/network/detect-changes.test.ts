import { fullDiff } from '../../lib';
import { resource, template } from '../util';

test('detect addition of all types of rules', () => {
  // WHEN
  const diff = fullDiff({}, template({
    SG: resource('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [
        {
          CidrIp: '1.2.3.4/8',
          FromPort: 80,
          ToPort: 80,
          IpProtocol: 'tcp',
        },
      ],
      SecurityGroupEgress: [
        {
          DestinationSecurityGroupId: { 'Fn::GetAtt': ['ThatOtherGroup', 'GroupId'] },
          FromPort: 80,
          ToPort: 80,
          IpProtocol: 'tcp',
        },
      ],
    }),
    InRule: resource('AWS::EC2::SecurityGroupIngress', {
      GroupId: { 'Fn::GetAtt': ['SG', 'GroupId'] },
      FromPort: -1,
      ToPort: -1,
      IpProtocol: 'icmp',
      SourcePrefixListId: 'pl-1234',
    }),
    OutRule: resource('AWS::EC2::SecurityGroupEgress', {
      GroupId: { 'Fn::GetAtt': ['SG', 'GroupId'] },
      FromPort: -1,
      ToPort: -1,
      IpProtocol: 'udp',
      CidrIp: '7.8.9.0/24',
    }),
  }));

  // THEN
  expect(diff.securityGroupChanges.toJson()).toEqual({
    ingressRuleAdditions: [
      {
        groupId: '${SG.GroupId}',
        ipProtocol: 'tcp',
        fromPort: 80,
        toPort: 80,
        peer: { kind: 'cidr-ip', ip: '1.2.3.4/8' },
      },
      {
        groupId: '${SG.GroupId}',
        ipProtocol: 'icmp',
        fromPort: -1,
        toPort: -1,
        peer: { kind: 'prefix-list', prefixListId: 'pl-1234' },
      },
    ],
    egressRuleAdditions: [
      {
        groupId: '${SG.GroupId}',
        ipProtocol: 'tcp',
        fromPort: 80,
        toPort: 80,
        peer: { kind: 'security-group', securityGroupId: '${ThatOtherGroup.GroupId}' },
      },
      {
        groupId: '${SG.GroupId}',
        ipProtocol: 'udp',
        fromPort: -1,
        toPort: -1,
        peer: { kind: 'cidr-ip', ip: '7.8.9.0/24' },
      },
    ],
  });
});

test('detect a rule moving from one security group to a different one', () => {
  // A rule with the same protocol/port/peer moves from WebSG to DbSG between the
  // old and new templates. This must be reported as a removal from WebSG and an
  // addition to DbSG -- it must not be treated as unchanged just because the
  // rule's shape (ignoring which group it's attached to) happens to match.
  const oldTemplate = template({
    WebSG: resource('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [
        {
          CidrIp: '10.0.0.0/24',
          FromPort: 22,
          ToPort: 22,
          IpProtocol: 'tcp',
        },
      ],
    }),
    DbSG: resource('AWS::EC2::SecurityGroup', {}),
  });

  const newTemplate = template({
    WebSG: resource('AWS::EC2::SecurityGroup', {}),
    DbSG: resource('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [
        {
          CidrIp: '10.0.0.0/24',
          FromPort: 22,
          ToPort: 22,
          IpProtocol: 'tcp',
        },
      ],
    }),
  });

  // WHEN
  const diff = fullDiff(oldTemplate, newTemplate);

  // THEN
  expect(diff.securityGroupChanges.toJson()).toEqual({
    ingressRuleAdditions: [
      {
        groupId: '${DbSG.GroupId}',
        ipProtocol: 'tcp',
        fromPort: 22,
        toPort: 22,
        peer: { kind: 'cidr-ip', ip: '10.0.0.0/24' },
      },
    ],
    ingressRuleRemovals: [
      {
        groupId: '${WebSG.GroupId}',
        ipProtocol: 'tcp',
        fromPort: 22,
        toPort: 22,
        peer: { kind: 'cidr-ip', ip: '10.0.0.0/24' },
      },
    ],
  });
});
